import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { assert } from "./errors";
import { digest } from "./security";
import { appendEvent, notifyConversation } from "./events";

export async function recordRunEvent(
  id: string,
  token: string,
  input: unknown,
) {
  const e = z
    .object({
      type: z.enum([
        "heartbeat",
        "tool",
        "tool_start",
        "tool_end",
        "message_start",
        "delta",
        "message_end",
        "complete",
        "paused",
        "failed",
        "waiting_inputs",
      ]),
      text: z.string().max(100000).optional(),
      tool: z.string().max(200).optional(),
      messageId: z.string().uuid().optional(),
      eventKey: z.string().max(250).optional(),
      jobIds: z.array(z.string()).max(10).optional(),
      attempt: z.number().int().optional(),
    })
    .parse(input);
  const result = await db.$transaction(async (tx) => {
    const initial = await tx.agentRun.findUnique({ where: { id } });
    assert(initial, 404, "运行不存在");
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${initial.conversationId} FOR UPDATE`;
    const run = await tx.agentRun.findUniqueOrThrow({ where: { id } });
    assert(digest(token) === run.tokenHash, 401, "此执行实例的租约已失效");
    const owner = await tx.user.findUnique({ where: { id: run.ownerId } });
    const source = run.sourceKeyId
      ? await tx.apiKey.findUnique({ where: { id: run.sourceKeyId } })
      : null;
    if (
      !owner?.active ||
      !["admin", "editor"].includes(owner.role) ||
      (run.sourceKeyId &&
        (!source?.enabled ||
          source.revokedAt ||
          (source.expiresAt && source.expiresAt <= new Date()) ||
          !source.scopes.includes("write") ||
          (source.productIds.length &&
            (!run.productIds.length ||
              run.productIds.some((p) => !source.productIds.includes(p))))))
    ) {
      await tx.agentRun.update({
        where: { id },
        data: { status: "stopped", stopRequested: true, leaseUntil: null },
      });
      await tx.message.updateMany({
        where: { runId: id, status: "streaming" },
        data: { status: "stopped" },
      });
      await appendEvent(
        tx,
        run.conversationId,
        "run",
        { id, status: "stopped" },
        id,
      );
      return { stopRequested: true, conversationId: run.conversationId };
    }
    if (run.stopRequested || run.status !== "running")
      return { stopRequested: true, conversationId: run.conversationId };
    if (e.attempt !== undefined)
      assert(e.attempt === run.attempt, 409, "运行尝试已变化");
    if (e.type === "heartbeat") {
      await tx.agentRun.update({
        where: { id },
        data: { leaseUntil: new Date(Date.now() + 90000) },
      });
      return { stopRequested: false, conversationId: run.conversationId };
    }
    const key = `${id}:${e.eventKey ?? randomUUID()}`;
    if (await tx.agentEvent.findUnique({ where: { eventKey: key } }))
      return { duplicate: true, conversationId: run.conversationId };
    let data: any = { ...e, runId: id };
    if (e.type === "message_start") {
      assert(e.messageId, 422, "缺少消息标识");
      await tx.message.create({
        data: {
          id: e.messageId,
          conversationId: run.conversationId,
          runId: id,
          role: "assistant",
          text: "",
          status: "streaming",
        },
      });
    } else if (e.type === "delta" || e.type === "message_end") {
      assert(e.messageId, 422, "缺少消息标识");
      const m = await tx.message.findUnique({ where: { id: e.messageId } });
      assert(m?.runId === id && m.status === "streaming", 409, "消息已经结束");
      await tx.message.update({
        where: { id: m.id },
        data:
          e.type === "delta"
            ? { text: m.text + (e.text ?? "") }
            : { status: "completed" },
      });
    } else if (e.type === "waiting_inputs") {
      const jobIds = e.jobIds ?? [];
      assert(jobIds.length, 422, "缺少附件任务");
      const jobs = await tx.job.findMany({ where: { id: { in: jobIds } } });
      assert(
        jobs.length === jobIds.length &&
          jobs.every(
            (j) =>
              j.conversationId === run.conversationId ||
              (!!j.productId &&
                (!run.productIds.length ||
                  run.productIds.includes(j.productId))),
          ),
        403,
        "无权等待此任务",
      );
      await tx.agentRun.update({
        where: { id },
        data: {
          status: "waiting_inputs",
          inputJobIds: jobIds,
          leaseUntil: null,
        },
      });
    } else if (["complete", "paused", "failed"].includes(e.type)) {
      const status = e.type === "complete" ? "completed" : e.type;
      await tx.agentRun.update({
        where: { id },
        data: {
          status,
          result: e.text,
          error: e.type === "failed" ? e.text : null,
          leaseUntil: null,
        },
      });
      await tx.message.updateMany({
        where: { runId: id, status: "streaming" },
        data: { status: e.type === "complete" ? "completed" : "interrupted" },
      });
      if (
        e.text &&
        !(await tx.message.findFirst({
          where: { runId: id, text: e.text, status: "completed" },
        }))
      ) {
        const m = await tx.message.create({
          data: {
            conversationId: run.conversationId,
            runId: id,
            role: "assistant",
            text: e.text,
            status: e.type === "failed" ? "failed" : "completed",
          },
        });
        data.message = m;
      }
      data.status = status;
    }
    const event = await appendEvent(
      tx,
      run.conversationId,
      e.type,
      data,
      id,
      key,
    );
    return { event, conversationId: run.conversationId };
  });
  void notifyConversation(result.conversationId);
  return result;
}
