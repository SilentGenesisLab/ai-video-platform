import { workerActor } from "../lib/worker-access";
import { settleUsage, usageFromResult } from "../lib/billing";
import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { db, systemDb, withTeam } from "../lib/db";
import { json } from "../lib/services";
import { canonical, digest, redact } from "../lib/security";
import { persistBuffer } from "../lib/storage";
import { assert } from "../lib/errors";
import { refreshBatch } from "../lib/production";
import {
  downloadResult,
  generationPayload,
  providerPath,
  providerRequest,
} from "./provider";
import { buildOverview, parseFile, probeMedia } from "./media";
import { reserveSubmission, providerResult } from "./lifecycle";
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = {
  db: Number(redisUrl.pathname.slice(1) || 0),
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
  username: redisUrl.username || undefined,
  maxRetriesPerRequest: null,
};
const queue = new Queue("aivideo-media", { connection });
let closing = false;
async function schedule(jobId: string, phase: string, delay = 0) {
  await db.outbox.create({
    data: { jobId, phase, availableAt: new Date(Date.now() + delay) },
  });
}
async function execute(id: string, phase: string) {
  const found = await systemDb.job.findUnique({ where: { id } });
  if (!found) return;
  return withTeam(found.teamId, () => executeScoped(id, phase));
}
async function executeScoped(id: string, phase: string) {
  const owner = randomUUID();
  const claimed = await db.job.updateMany({
    where: {
      id,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 180000) },
  });
  if (!claimed.count) {
    await schedule(id, phase, 5000);
    return;
  }
  const heartbeat = setInterval(() => {
    void db.job
      .updateMany({
        where: { id, leaseOwner: owner },
        data: { leaseUntil: new Date(Date.now() + 180000) },
      })
      .catch(() => {});
  }, 30000);
  let job = await db.job.findUniqueOrThrow({
    where: { id },
    include: { batch: true },
  });
  try {
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return;
    if (phase === "cancel") {
      if (job.upstreamId && job.providerPath && job.channelId) {
        await providerRequest(
          job.channelId,
          job.providerPath + "/" + job.upstreamId + "/cancel",
          {},
          (job.input as any).channelSnapshot?.baseUrl,
        );
        await schedule(id, "poll", 3000);
      } else if (job.status === "queued")
        await db.job.update({ where: { id }, data: { status: "cancelled" } });
      return;
    }
    if (job.cancelRequested && job.status === "queued") {
      await db.job.update({ where: { id }, data: { status: "cancelled" } });
      return;
    }
    if (phase === "parse") {
      await parseFile((job.input as any).fileId, job.id);
      await db.job.update({
        where: { id },
        data: { status: "succeeded", phase: "done" },
      });
      return;
    }
    if (phase === "overview") {
      const result = await buildOverview(job);
      await db.job.update({
        where: { id },
        data: { status: "succeeded", phase: "done", result: json(result) },
      });
      return;
    }
    if (phase === "submit") {
      if (job.upstreamId) {
        await schedule(id, "poll");
        return;
      }
      if (job.status !== "queued") return;
      if (job.kind === "video")
        assert(
          job.batch?.approvedDigest &&
            job.batch.approvedDigest === job.batch.digest &&
            digest(canonical(job.batch.snapshot)) === job.batch.digest,
          409,
          "缺少有效视频审批",
        );
      await workerActor(job.teamId, job.batch?.createdBy ?? "missing");
      const usage = await db.usageRecord.findUnique({
        where: { id: (job.input as any).usageId ?? "missing" },
      });
      assert(usage?.status === "reserved", 409, "缺少有效积分冻结，禁止提交");
      const path = providerPath(job.kind);
      if (
        !(await reserveSubmission(
          id,
          job.channelId!,
          (job.input as any).channelSnapshot.baseUrl,
          path,
        ))
      ) {
        await schedule(id, "submit", 5000);
        return;
      }
      try {
        const response = await providerRequest(
          job.channelId!,
          path,
          generationPayload(job),
          (job.input as any).channelSnapshot?.baseUrl,
        );
        assert(
          typeof response.job_id === "string" && response.job_id.length > 0,
          502,
          "供应商未返回任务 ID",
        );
        await db.$transaction(async (tx) => {
          await tx.job.update({
            where: { id },
            data: {
              upstreamId: response.job_id,
              actualChannel:
                response.channel ?? response.requested_channel ?? null,
              status: "running",
              phase: "poll",
            },
          });
          await tx.outbox.create({
            data: {
              jobId: id,
              phase: "poll",
              availableAt: new Date(Date.now() + 3000),
            },
          });
        });
      } catch (e) {
        const status = (e as any).httpStatus;
        await db.job.update({
          where: { id },
          data: {
            status:
              status && status >= 400 && status < 500 && status !== 408
                ? "failed"
                : "submission_unknown",
            error: String(redact((e as Error).message)),
          },
        });
      }
      return;
    }
    if (phase === "poll") {
      if (
        !job.upstreamId ||
        !job.providerPath ||
        !job.channelId ||
        ["transferring", "transfer_failed"].includes(job.status)
      )
        return;
      const result = await providerRequest(
        job.channelId,
        job.providerPath + "/" + job.upstreamId,
        undefined,
        (job.input as any).channelSnapshot?.baseUrl,
      );
      const state = result.status ?? result.state;
      if (
        ["succeeded", "completed", "failed", "cancelled"].includes(state) &&
        (job.input as any).usageId
      )
        await usageFromResult(
          (job.input as any).usageId,
          result,
          ["succeeded", "completed"].includes(state),
        );
      if (["succeeded", "completed"].includes(state)) {
        await db.$transaction(async (tx) => {
          await tx.job.update({
            where: { id },
            data: {
              status: "transferring",
              phase: "transfer",
              actualChannel: result.channel ?? job.actualChannel,
              result: providerResult(result),
              error: null,
            },
          });
          await tx.outbox.create({ data: { jobId: id, phase: "transfer" } });
        });
      } else if (["failed", "cancelled"].includes(state))
        await db.job.update({
          where: { id },
          data: {
            status: state,
            error: result.error
              ? String(
                  redact(
                    typeof result.error === "string"
                      ? result.error
                      : JSON.stringify(result.error),
                  ),
                )
              : null,
            result: json(redact(result)),
          },
        });
      else
        await schedule(
          id,
          "poll",
          Date.now() - job.createdAt.getTime() < 60000 ? 3000 : 10000,
        );
      return;
    }
    if (phase === "transfer") {
      if (job.phase !== "transfer") return;
      const result = job.result as any,
        urls =
          result.result_urls ?? (result.result_url ? [result.result_url] : []);
      assert(urls.length, 502, "供应商成功但没有结果文件");
      const files: any[] = [];
      for (let index = 0; index < urls.length; index++) {
        const existing = await db.fileObject.findFirst({
          where: {
            productId: job.productId,
            metadata: { path: ["outputKey"], equals: `${id}:${index}` },
          },
        });
        if (existing) {
          files.push({
            fileId: existing.id,
            key: existing.key,
            mime: existing.mime,
          });
          continue;
        }
        const { buffer, mime } = await downloadResult(urls[index]);
        const ext =
          job.kind === "video"
            ? "mp4"
            : job.kind === "audio"
              ? "mp3"
              : mime.includes("jpeg")
                ? "jpg"
                : mime.includes("webp")
                  ? "webp"
                  : "png";
        const metadata = await probeMedia(buffer, mime);
        const file = await persistBuffer(
          job.productId,
          `${job.kind}-${id}-${index + 1}.${ext}`,
          mime,
          buffer,
          "worker",
          {
            ...metadata,
            jobId: id,
            outputKey: `${id}:${index}`,
            sources: (job.input as any).sources,
          },
        );
        files.push({ fileId: file.id, key: file.key, mime: file.mime });
      }
      await db.job.update({
        where: { id },
        data: {
          status: "succeeded",
          phase: "done",
          result: json({ ...result, files }),
          error: null,
        },
      });
    }
  } catch (e) {
    const error = String(redact(e instanceof Error ? e.message : String(e)));
    if (phase === "poll" || phase === "cancel") {
      await db.job.update({ where: { id }, data: { error } });
      await schedule(id, phase, 15000);
    } else
      await db.job.update({
        where: { id },
        data: {
          status: phase === "transfer" ? "transfer_failed" : "failed",
          error,
        },
      });
  } finally {
    clearInterval(heartbeat);
    const latest = await db.job.findUnique({ where: { id } });
    if (
      latest &&
      (latest.status !== job.status ||
        latest.phase !== job.phase ||
        latest.error !== job.error)
    )
      await db.auditEvent.create({
        data: {
          actorId: "media-worker",
          actorType: "worker",
          action: "job.state_changed",
          entityId: id,
          productId: job.productId,
          data: json({
            from: job.status,
            to: latest.status,
            phase: latest.phase,
            upstreamId: latest.upstreamId,
            error: redact(latest.error),
          }),
        },
      });
    await db.job.updateMany({
      where: { id, leaseOwner: owner },
      data: { leaseOwner: null, leaseUntil: null },
    });
    if (latest && (latest.input as any).usageId) {
      const u = await db.usageRecord.findUnique({
        where: { id: (latest.input as any).usageId },
      });
      if (
        u?.status === "reserved" &&
        ["cancelled", "failed", "submission_unknown"].includes(latest.status)
      )
        await settleUsage(
          u.id,
          !latest.upstreamId && !latest.providerPath && job.status === "queued"
            ? 0
            : null,
        );
    }
    await refreshBatch(job.batchId);
  }
}
const worker = new Worker(
  "aivideo-media",
  async (task) => execute(task.data.jobId, task.data.phase),
  { connection, concurrency: Number(process.env.MEDIA_CONCURRENCY ?? 3) },
);
worker.on("error", (e) => console.error(String(redact(e.message))));
async function dispatch() {
  if (closing) return;
  try {
    const entries = await db.outbox.findMany({
      where: { deliveredAt: null, availableAt: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    for (const item of entries) {
      await queue.add(
        item.phase,
        { jobId: item.jobId, phase: item.phase },
        {
          jobId: item.id,
          removeOnComplete: { age: 86400 },
          removeOnFail: { age: 604800 },
        },
      );
      await db.outbox.update({
        where: { id: item.id },
        data: { deliveredAt: new Date() },
      });
    }
    await db.job.updateMany({
      where: {
        status: "submitting",
        upstreamId: null,
        updatedAt: { lt: new Date(Date.now() - 240000) },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: {
        status: "submission_unknown",
        error: "提交进程中断，需确认供应商是否已接单；系统没有重新提交。",
      },
    });
    await db.usageRecord.updateMany({
      where: {
        status: "submitting",
        updatedAt: { lt: new Date(Date.now() - 300000) },
      },
      data: {
        status: "reconcile",
        error: "调用进程中断或结果未确认，等待对账",
      },
    });
    const uncertain = await db.job.findMany({
      where: { status: "submission_unknown" },
      take: 100,
    });
    for (const job of uncertain) {
      const id = (job.input as any).usageId;
      if (id) {
        const u = await db.usageRecord.findUnique({ where: { id } });
        if (u?.status === "reserved") await settleUsage(id, null);
      }
    }
    // Recover lost Redis messages using durable job state; provider submission is never replayed after it starts.
    const stale = await db.job.findMany({
      where: {
        status: { in: ["queued", "running", "transferring"] },
        updatedAt: { lt: new Date(Date.now() - 60000) },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      take: 50,
    });
    for (const job of stale) {
      const pending = await db.outbox.findFirst({
        where: { jobId: job.id, deliveredAt: null },
      });
      if (!pending) {
        await schedule(
          job.id,
          job.kind === "parse"
            ? "parse"
            : job.kind === "overview"
              ? "overview"
              : job.phase,
        );
        await db.job.update({
          where: { id: job.id },
          data: { updatedAt: new Date() },
        });
      }
    }
  } catch (e) {
    console.error(String(redact(e instanceof Error ? e.message : String(e))));
  } finally {
    if (!closing) setTimeout(dispatch, 1500);
  }
}
void dispatch();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    closing = true;
    await worker.close();
    await queue.close();
    await db.$disconnect();
    process.exit(0);
  });
console.log("Media worker ready");
