import { z } from "zod";
import { createHmac } from "node:crypto";
import { requireHuman, requireScope, type Actor } from "./auth";
import { assert } from "./errors";
import { audit, json, type Tx } from "./services";

/**
 * Frameflow Film 是一条独立的 n8n 流水线：一段产品描述 → 分镜 → 分段生成 → 拼接 → Suno 配乐。
 *
 * 平台在这里只做三件事：入口、人工确认、状态聚合。
 * - 下单和审批都调 n8n Webhook；凭据只放服务端环境变量。
 * - 任务存在既有的 Job 表（kind = "film_pipeline"），不新建表。
 * - 审批必须由人类发起：`approveFilmJob` 先 `requireHuman`，Agent Key 调不到。
 */

const orderUrl = () => process.env.FILM_ORDER_URL ?? "";
const statusUrl = () => process.env.FILM_STATUS_URL ?? "";
const approveUrl = () => process.env.FILM_APPROVE_URL ?? "";
const orderToken = () => process.env.FILM_ORDER_TOKEN ?? "";
const signingSecret = () => process.env.FILM_SIGNING_SECRET ?? "";

export function filmConfigured() {
  return Boolean(
    orderUrl() && statusUrl() && approveUrl() && orderToken() && signingSecret(),
  );
}

export const filmInput = z.object({
  brief: z.string().trim().min(8).max(4000),
  title: z.string().trim().max(80).optional(),
  product_name: z.string().trim().max(80).optional(),
  target_seconds: z.number().int().min(8).max(180).optional(),
  aspect_ratio: z.enum(["9:16", "16:9", "1:1", "4:3", "3:4"]).optional(),
  reference_image_urls: z.array(z.string().url()).max(3).optional(),
  conversationId: z.string().uuid().optional(),
});

/** 提交一条出片任务。此时**不产生费用**：n8n 侧只做分镜规划，等人工确认才调付费模型。 */
export async function createFilmJob(actor: Actor, input: unknown, tx: Tx) {
  requireScope(actor, "write");
  requireScope(actor, "generate");
  assert(filmConfigured(), 503, "出片流水线尚未配置");
  const data = filmInput.parse(input);
  const { conversationId, ...payload } = data;
  const response = await fetch(orderUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Film-Token": orderToken() },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90000),
  });
  const out: any = await response.json().catch(() => ({}));
  assert(
    response.ok && out?.ok && typeof out.job_id === "string",
    response.status === 422 ? 422 : 502,
    String(out?.error ?? "流水线受理失败"),
  );
  const job = await tx.job.create({
    data: {
      conversationId: conversationId ?? null,
      teamId: actor.teamId,
      kind: "film_pipeline",
      status: "pending_approval",
      phase: "plan",
      input: json({
        ...payload,
        pipelineJobId: out.job_id,
        createdBy: actor.userId,
      }),
    },
  });
  await audit(tx, actor, "film.create", job.id, null, {
    pipelineJobId: out.job_id,
  });
  return {
    id: job.id,
    pipelineJobId: out.job_id,
    status: "pending_approval",
    statusUrl: typeof out.status_url === "string" ? out.status_url : null,
  };
}

async function filmRow(actor: Actor, id: string, tx: Tx) {
  const job = await tx.job.findFirst({
    where: { id, kind: "film_pipeline", teamId: actor.teamId },
  });
  assert(job, 404, "找不到该出片任务");
  return job;
}

/** 读 n8n 侧状态。只读，不改本地状态。 */
export async function filmJobStatus(actor: Actor, id: string, tx: Tx) {
  const job = await filmRow(actor, id, tx);
  const input = job.input as any;
  const response = await fetch(
    `${statusUrl()}?job_id=${encodeURIComponent(String(input.pipelineJobId))}`,
    { signal: AbortSignal.timeout(30000) },
  );
  const out: any = await response.json().catch(() => ({}));
  assert(response.ok, 502, "流水线状态读取失败");
  return { ...out, id: job.id, pipelineJobId: input.pipelineJobId };
}

/** 人工确认。Agent Key 会在这里被 requireHuman 拒掉。 */
export async function approveFilmJob(actor: Actor, id: string, tx: Tx) {
  requireHuman(actor);
  requireScope(actor, "write");
  requireScope(actor, "generate");
  assert(filmConfigured(), 503, "出片流水线尚未配置");
  const job = await filmRow(actor, id, tx);
  assert(job.status === "pending_approval", 409, "该任务已处置");
  const input = job.input as any;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const message = `job=${input.pipelineJobId}|decision=approve|exp=${exp}`;
  const sig = createHmac("sha256", signingSecret())
    .update(message)
    .digest("hex");
  const response = await fetch(
    `${approveUrl()}?job=${encodeURIComponent(String(input.pipelineJobId))}` +
      `&decision=approve&exp=${exp}&sig=${sig}`,
    { signal: AbortSignal.timeout(60000) },
  );
  assert(response.ok, 502, `流水线审批未生效 HTTP ${response.status}`);
  await tx.job.update({ where: { id }, data: { status: "approved" } });
  await audit(tx, actor, "film.approve", id, null, {
    pipelineJobId: input.pipelineJobId,
  });
  return { ok: true, id, pipelineJobId: input.pipelineJobId };
}

/** 把待确认的流水线任务投影成助手媒体卡片能直接渲染的形态。 */
export async function filmConsentItem(actor: Actor, job: any) {
  const input = job.input as any;
  const pipelineJobId = String(input.pipelineJobId ?? "");
  const res = await fetch(
    `${statusUrl()}?job_id=${encodeURIComponent(pipelineJobId)}`,
    { signal: AbortSignal.timeout(15000) },
  )
    .then((r) => r.json())
    .catch(() => null);
  const done = Boolean(res?.result_url);
  return {
    id: job.id,
    title: String(input.title || `出片 · ${pipelineJobId}`),
    kind: "film",
    status: job.status === "approved" ? res?.status ?? job.status : job.status,
    canConfirm: actor.type === "human" && job.status === "pending_approval",
    estimatedCredits: 0,
    count: Number(res?.unit_count) || 0,
    targetSeconds: Number(input.target_seconds) || 40,
    pipelineJobId,
    jobs: [
      {
        id: job.id + ":film",
        status: done ? "succeeded" : res?.status ?? job.status,
        files: done
          ? [{ id: job.id + ":out", mime: "video/mp4", url: res.result_url }]
          : [],
      },
    ],
  };
}
