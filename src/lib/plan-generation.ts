import { z } from "zod";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { db, systemDb, withTeam } from "./db";
import { requireHuman, requireScope, type Actor } from "./auth";
import { requirePermission } from "./permissions";
import { assert } from "./errors";
import { audit, getResource, saveResource, json, type Tx } from "./services";
import { contentSchemas } from "./contracts";
import { meteredCall } from "./metering";
import { workerActor } from "./worker-access";

export const planRequest = z.object({
  baseVersion: z.number().int().positive(),
  draft: z
    .object({
      title: z.string().min(1).max(240),
      status: z.enum(["draft", "selected", "rejected", "ready"]),
      content: z.record(z.string(), z.unknown()),
    })
    .optional(),
});
export const generatedPlan = z
  .object({
    title: z.string().min(1).max(240),
    content: contentSchemas.plan,
  })
  .refine(
    (v) =>
      Boolean(
        (v.content as any).story?.trim() && (v.content as any).body?.trim(),
      ),
    "策划案必须包含叙事与完整方案",
  );

export async function requestPlan(
  actor: Actor,
  conceptId: string,
  input: unknown,
  tx: Tx,
) {
  requireHuman(actor);
  requireScope(actor, "write");
  requireScope(actor, "generate");
  requirePermission(actor, "creative.generate");
  const data = planRequest.parse(input);
  // An untouched numeric field in the editor is an empty string, not a score.
  if (data.draft?.content.score === "") delete data.draft.content.score;
  assert(
    process.env.N8N_PLAN_WEBHOOK_URL && process.env.N8N_PLAN_SECRET,
    503,
    "策划案工作流尚未配置",
  );
  await tx.$queryRaw`SELECT id FROM "Resource" WHERE id = ${conceptId} FOR UPDATE`;
  let concept = await getResource(actor, conceptId, tx);
  assert(concept.kind === "concept" && concept.productId, 422, "需要有效创意");
  assert(concept.version === data.baseVersion, 409, "创意已更新，请刷新后生成");
  const active = await tx.job.findFirst({
    where: {
      teamId: actor.teamId,
      kind: "plan_generation",
      status: { in: ["queued", "running"] },
      input: { path: ["concept", "id"], equals: conceptId },
    },
  });
  assert(!active, 409, "这条创意已有策划案生成任务");
  const channel = await tx.channel.findFirst({
    where: { provider: "deepseek", enabled: true },
  });
  const model = (channel?.models as any)?.text?.[0];
  assert(channel && model, 503, "DeepSeek 文本渠道不可用");
  if (
    data.draft &&
    JSON.stringify({
      title: concept.title,
      status: concept.status,
      content: concept.content,
    }) !== JSON.stringify(data.draft)
  ) {
    concept = await saveResource(
      actor,
      "concept",
      { ...data.draft, baseVersion: data.baseVersion },
      tx,
      conceptId,
    );
  }
  const product = await getResource(actor, concept.productId!, tx);
  const snapshot = (r: any) => ({
    id: r.id,
    title: r.title,
    version: r.version,
    content: r.content,
  });
  const job = await tx.job.create({
    data: {
      id: randomUUID(),
      teamId: actor.teamId,
      productId: concept.productId,
      kind: "plan_generation",
      phase: "plan",
      status: "queued",
      channelId: channel.id,
      input: json({
        createdBy: actor.userId,
        concept: snapshot(concept),
        product: snapshot(product),
        channelId: channel.id,
        model,
        workflowVersion: "v1",
      }),
    },
  });
  await tx.outbox.create({ data: { jobId: job.id, phase: "plan" } });
  await audit(tx, actor, "concept.generate_plan", job.id, concept.productId, {
    conceptId,
    sourceVersion: concept.version,
    workflow: "n8n",
  });
  return job;
}

export function authorizePlanBridge(header: string | null) {
  const secret = process.env.N8N_PLAN_SECRET;
  const a = Buffer.from(header ?? ""),
    b = Buffer.from(secret ?? "");
  assert(
    secret && a.length === b.length && timingSafeEqual(a, b),
    401,
    "工作流鉴权失败",
  );
}

/** Restricted bridge: only a pre-existing running plan job can call its selected model. */
export async function planBridge(jobId: string, messages?: unknown) {
  const job = await systemDb.job.findUnique({ where: { id: jobId } });
  assert(
    job?.kind === "plan_generation" &&
      job.status === "running" &&
      !job.cancelRequested,
    409,
    "策划任务不可执行",
  );
  return withTeam(job.teamId, async () => {
    const input = job.input as any;
    const actor = await workerActor(job.teamId, input.createdBy);
    requireScope(actor, "write");
    await getResource(actor, input.concept.id);
    await getResource(actor, input.product.id);
    if (!messages)
      return {
        jobId,
        concept: input.concept,
        product: input.product,
        model: input.model,
      };
    const checked = z
      .array(
        z
          .object({
            role: z.enum(["system", "user"]),
            content: z.string().min(1).max(90000),
          })
          .strict(),
      )
      .min(2)
      .max(2)
      .parse(messages);
    const response: any = await meteredCall(
      actor,
      `plan:${jobId}:draft`,
      input.channelId,
      "text",
      input.model,
      {
        model: input.model,
        messages: checked,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 6500,
      },
    );
    return { jobId, response, model: input.model };
  });
}

export async function persistPlan(
  jobId: string,
  output: unknown,
  transaction?: Tx,
) {
  const data = generatedPlan.parse(output);
  const save = async (tx: Tx) => {
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${jobId} FOR UPDATE`;
    const job = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status === "succeeded") return job.result;
    assert(!job.cancelRequested && job.status === "running", 409, "任务已停止");
    const input = job.input as any,
      actor = await workerActor(job.teamId, input.createdBy);
    requireScope(actor, "write");
    const plan = await saveResource(
      actor,
      "plan",
      {
        ...data,
        productId: job.productId,
        parentId: input.concept.id,
        status: "draft",
        sources: [
          { resourceId: input.concept.id, version: input.concept.version },
          { resourceId: input.product.id, version: input.product.version },
        ],
      },
      tx,
    );
    const result = {
      planId: plan.id,
      title: plan.title,
      conceptId: input.concept.id,
      sourceVersion: input.concept.version,
      workflowExecutionId: (output as any).executionId ?? null,
    };
    await tx.job.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        phase: "done",
        result: json(result),
        error: null,
      },
    });
    await audit(tx, actor, "plan.generated", plan.id, job.productId, {
      jobId,
      ...result,
    });
    return result;
  };
  return transaction ? save(transaction) : db.$transaction(save);
}
