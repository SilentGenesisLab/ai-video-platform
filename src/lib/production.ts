import { checkBatchPermission } from "./key-authorization";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  batchDigest,
  rateLine,
  reserveUsage,
  validateQuoteRates,
} from "./billing";
import { batchInput, GenerationEntry } from "./contracts";
import { Actor, productAccess, requireHuman, requireScope } from "./auth";
import { assert } from "./errors";
import { canonical, digest } from "./security";
import {
  audit,
  checkedSources,
  getResource,
  json,
  Tx,
  validateFiles,
} from "./services";
import { db } from "./db";
export async function validateEntry(
  actor: Actor,
  kind: string,
  entry: GenerationEntry,
  productId: string,
  planId: string | undefined,
  tx: Tx,
) {
  const channel = await tx.channel.findUnique({
    where: { id: entry.channelId },
  });
  assert(
    channel?.enabled && channel.provider === "aicentre",
    422,
    "生成渠道不可用",
  );
  const models = channel.models as Record<string, string[]>;
  assert(models[kind]?.includes(entry.model), 422, "模型不支持该生成类型");
  const files = await validateFiles(
    actor,
    entry.referenceFileIds,
    productId,
    tx,
  );
  const ordered = entry.referenceFileIds.map((id) =>
    files.find((f) => f.id === id)!,
  );
  const images = ordered.filter((f) => f.mime.startsWith("image/")),
    videos = ordered.filter((f) => f.mime.startsWith("video/")),
    audios = ordered.filter((f) => f.mime.startsWith("audio/"));
  assert(
    images.length + videos.length + audios.length === ordered.length,
    422,
    "生成参考仅支持图片、视频和音频",
  );
  entry = {
    ...entry,
    parameters:
      kind === "video"
        ? {
            duration_seconds: 5,
            resolution: "720p",
            aspect_ratio: "16:9",
            sound: false,
            ...entry.parameters,
          }
        : kind === "image"
          ? { image_size: "1K", aspect_ratio: "16:9", ...entry.parameters }
          : entry.parameters,
  };
  const p = entry.parameters;
  if (kind === "audio") {
    assert(entry.prompt.length <= 2000, 422, "音乐描述最多 2000 字符");
    if (entry.model === "suno-sound") {
      assert(p.title && p.title.length <= 100, 422, "音效需要 1–100 字符标题");
      assert(
        (p.tags || entry.prompt).length <= 600,
        422,
        "音效描述最多 600 字符",
      );
    }
  }
  if (kind === "image") {
    assert(
      images.length <= 9 && !videos.length && !audios.length,
      422,
      "图片生成最多引用 9 张图片",
    );
    assert(
      !p.image_size || ["1K", "2K", "4K"].includes(p.image_size),
      422,
      "无效图片尺寸",
    );
  }
  if (kind === "video") {
    const is25 = entry.model === "seedance-2.5";
    assert(
      ["seedance-2.0", "seedance-2.5"].includes(entry.model),
      422,
      "首版适配 Seedance 2.0/2.5",
    );
    assert(
      (p.duration_seconds ?? 5) >= 4 &&
        (p.duration_seconds ?? 5) <= (is25 ? 30 : 15),
      422,
      "视频时长超出模型限制",
    );
    assert(
      images.length <= (is25 ? 30 : 9) &&
        videos.length <= (is25 ? 10 : 3) &&
        audios.length <= (is25 ? 10 : 3),
      422,
      "参考素材数量超限",
    );
    assert(
      !p.resolution || ["480p", "720p", "1080p"].includes(p.resolution),
      422,
      "不支持的分辨率",
    );
    assert(
      !(audios.length && p.resolution === "1080p"),
      422,
      "当前 1080p 渠道不支持独立音频参考",
    );
    const duration = videos
      .concat(audios)
      .reduce((n, f) => n + Number((f.metadata as any)?.duration ?? NaN), 0);
    assert(Number.isFinite(duration), 422, "参考音视频需先完成时长解析");
    if (is25) assert(duration <= 30, 422, "参考音视频总时长不能超过 30 秒");
  }
  if (p.aspect_ratio)
    assert(
      ["9:16", "16:9", "1:1", "4:3", "3:4", "2:3", "3:2"].includes(
        p.aspect_ratio,
      ),
      422,
      "无效画幅",
    );
  const sources = await checkedSources(actor, entry.sources, productId, tx);
  if (entry.targetResourceId) {
    const target = await getResource(actor, entry.targetResourceId, tx);
    assert(target.productId === productId, 422, "生成目标产品不匹配");
    assert(
      !planId || !target.planId || target.planId === planId,
      422,
      "生成目标策划案不匹配",
    );
    assert(
      ["asset", "storyboard", "script"].includes(target.kind),
      422,
      "无效生成目标",
    );
    if (entry.targetShotId)
      assert(
        target.kind === "storyboard" &&
          (target.content as any).shots.some(
            (s: any) => s.id === entry.targetShotId,
          ),
        422,
        "目标镜头不存在",
      );
    if (!sources.some((s) => s.resourceId === target.id))
      sources.push({ resourceId: target.id, version: target.version });
  }
  return {
    ...entry,
    sources,
    references: ordered.map((f) => ({
      id: f.id,
      key: f.key,
      mime: f.mime,
      sha256: f.sha256,
      metadata: f.metadata,
    })),
    channelSnapshot: {
      id: channel.id,
      baseUrl: channel.baseUrl,
      provider: channel.provider,
    },
  };
}
export async function createBatch(actor: Actor, input: unknown, tx: Tx) {
  requireScope(actor, "generate");
  const data = batchInput.parse(input);
  await checkBatchPermission(actor, data);
  productAccess(actor, data.productId);
  const product = await getResource(actor, data.productId, tx);
  assert(product.kind === "product", 422, "无效产品");
  if (data.planId) {
    const plan = await getResource(actor, data.planId, tx);
    assert(
      plan.kind === "plan" && plan.productId === data.productId,
      422,
      "无效策划案",
    );
  }
  const entries = [];
  for (const entry of data.entries) {
    const sources = [...entry.sources];
    if (!sources.some((s) => s.resourceId === product.id))
      sources.push({ resourceId: product.id, version: product.version });
    if (data.planId && !sources.some((s) => s.resourceId === data.planId)) {
      const plan = await getResource(actor, data.planId, tx);
      sources.push({ resourceId: plan.id, version: plan.version });
    }
    entries.push(
      await validateEntry(
        actor,
        data.kind,
        { ...entry, sources },
        data.productId,
        data.planId,
        tx,
      ),
    );
  }
  assert(data.quoteId, 422, "请先获取并确认积分报价");
  const quote = await tx.creditQuote.findUnique({
    where: { id: data.quoteId },
  });
  assert(
    quote &&
      quote.actorId === actor.userId &&
      !quote.usedBy &&
      quote.expiresAt > new Date() &&
      quote.digest === batchDigest(data),
    409,
    "报价已失效或生成内容变化，请重新报价",
  );
  await validateQuoteRates(tx, quote.lines);
  const snapshot = {
      entries,
      productVersion: product.version,
      quoteId: quote.id,
      quoteExpiresAt: quote.expiresAt.toISOString(),
      quoteLines: quote.lines,
      estimatedCredits: quote.amount.toString(),
    },
    hash = digest(canonical(snapshot));
  const batch = await tx.productionBatch.create({
    data: {
      title: data.title,
      productId: data.productId,
      planId: data.planId,
      kind: data.kind,
      snapshot: json(snapshot),
      digest: hash,
      status: data.kind === "video" ? "pending_approval" : "queued",
      createdBy: actor.id,
    },
  });
  const used = await tx.creditQuote.updateMany({
    where: { id: quote.id, usedBy: null },
    data: { usedBy: batch.id },
  });
  assert(used.count === 1, 409, "报价已使用");
  if (data.kind !== "video") await enqueueBatch(tx, batch);
  await audit(tx, actor, "batch.created", batch.id, batch.productId, {
    kind: batch.kind,
    count: entries.length,
  });
  return batch;
}
async function enqueueBatch(
  tx: Tx,
  batch: {
    id: string;
    productId: string;
    planId: string | null;
    kind: string;
    snapshot: unknown;
    teamId: string;
    createdBy: string;
  },
) {
  for (const [index, entry] of (batch.snapshot as any).entries.entries()) {
    const job = await tx.job.create({
      data: {
        batchId: batch.id,
        productId: batch.productId,
        planId: batch.planId,
        kind: batch.kind,
        channelId: entry.channelId,
        input: json(entry),
      },
    });
    const usage = await reserveUsage(
      tx,
      { teamId: batch.teamId, userId: batch.createdBy },
      "job:" + job.id,
      (batch.snapshot as any).quoteLines[index],
      digest(canonical(entry)),
    );
    await tx.job.update({
      where: { id: job.id },
      data: { input: json({ ...entry, usageId: usage.id }) },
    });
    await tx.outbox.create({ data: { jobId: job.id, phase: "submit" } });
  }
}
export async function decideBatch(
  actor: Actor,
  id: string,
  input: { digest: string; decision: string },
) {
  requireHuman(actor);
  requireScope(actor, "approve");
  return db.$transaction(async (tx) => {
    const batch = await tx.productionBatch.findUnique({ where: { id } });
    assert(batch, 404, "批次不存在");
    productAccess(actor, batch.productId);
    assert(batch.status === "pending_approval", 409, "批次已处理");
    assert(
      input.digest === batch.digest &&
        digest(canonical(batch.snapshot)) === batch.digest,
      409,
      "审批内容已变化",
    );
    assert(["approve", "reject"].includes(input.decision), 422, "无效审批动作");
    const result = await tx.productionBatch.updateMany({
      where: { id, status: "pending_approval", digest: input.digest },
      data: {
        status: input.decision === "approve" ? "queued" : "rejected",
        approvedBy: actor.id,
        approvedAt: new Date(),
        approvedDigest: input.decision === "approve" ? input.digest : null,
      },
    });
    assert(result.count === 1, 409, "批次已被其他人处理");
    if (input.decision === "approve") {
      assert(
        new Date((batch.snapshot as any).quoteExpiresAt) > new Date(),
        409,
        "报价已过期，请重新提交报价与审批",
      );
      await validateQuoteRates(tx, (batch.snapshot as any).quoteLines);
      await enqueueBatch(tx, batch);
    }
    await audit(tx, actor, "batch." + input.decision, id, batch.productId, {
      digest: batch.digest,
    });
    return tx.productionBatch.findUniqueOrThrow({
      where: { id },
      include: { jobs: true },
    });
  });
}
export async function cancelJob(actor: Actor, id: string) {
  requireScope(actor, "generate");
  const job = await db.job.findUnique({ where: { id } });
  assert(job, 404, "任务不存在");
  productAccess(actor, job.productId);
  assert(
    !["succeeded", "failed", "cancelled"].includes(job.status),
    409,
    "任务已结束",
  );
  return db.$transaction(async (tx) => {
    await tx.job.update({ where: { id }, data: { cancelRequested: true } });
    await tx.outbox.create({ data: { jobId: id, phase: "cancel" } });
    await audit(tx, actor, "job.cancel_requested", id, job.productId);
    return { id, status: "cancel_requested" };
  });
}
export async function refreshBatch(id: string | null) {
  if (!id) return;
  const jobs = await db.job.findMany({ where: { batchId: id } });
  const finished = jobs.every((j) =>
    ["succeeded", "failed", "cancelled"].includes(j.status),
  );
  const status = finished
    ? jobs.every((j) => j.status === "succeeded")
      ? "succeeded"
      : jobs.some((j) => j.status === "succeeded")
        ? "partial_success"
        : jobs.every((j) => j.status === "cancelled")
          ? "cancelled"
          : "failed"
    : jobs.some((j) => j.status === "submission_unknown")
      ? "needs_attention"
      : "running";
  await db.productionBatch.update({ where: { id }, data: { status } });
}

// User intent authorizes image generation; video remains a human approval batch.
export async function generateMedia(actor: Actor, input: unknown, tx: Tx) {
  requireScope(actor, "generate");
  const d = z
    .object({
      kind: z.enum(["image", "video"]),
      productId: z.string().uuid(),
      planId: z.string().uuid().optional(),
      prompt: z.string().min(1).max(30000),
      title: z.string().min(1).max(240).default("助手生成"),
      count: z.number().int().min(1).max(20).default(1),
      referenceFileIds: z.array(z.string().uuid()).max(30).default([]),
      targetResourceId: z.string().uuid().optional(),
      parameters: z.record(z.string(), z.unknown()).default({}),
      sources: z
        .array(
          z.object({
            resourceId: z.string().uuid(),
            version: z.number().int().positive(),
          }),
        )
        .default([]),
    })
    .parse(input);
  await checkBatchPermission(actor, { kind: d.kind, entries: [d] });
  const preferred = d.kind === "image" ? "gpt-image-2.5" : "seedance-2.5";
  const channels = await tx.channel.findMany({
    where: { provider: "aicentre", enabled: true },
    orderBy: { createdAt: "asc" },
  });
  const channel =
    channels.find((c) => (c.models as any)[d.kind]?.includes(preferred)) ??
    channels.find((c) => (c.models as any)[d.kind]?.length);
  assert(channel, 503, "没有可用的媒体生成渠道，请管理员配置");
  const models = (channel.models as any)[d.kind];
  const model = models.includes(preferred) ? preferred : models[0];
  const data = batchInput.parse({
    title: d.title,
    kind: d.kind,
    productId: d.productId,
    planId: d.planId,
    entries: Array.from({ length: d.count }, () => ({
      channelId: channel.id,
      model,
      prompt: d.prompt,
      referenceFileIds: d.referenceFileIds,
      targetResourceId: d.targetResourceId,
      parameters: d.parameters,
      sources: d.sources,
    })),
  });
  const lines = [];
  for (const entry of data.entries) {
    const normalized = await validateEntry(
      actor,
      d.kind,
      entry,
      d.productId,
      d.planId,
      tx,
    );
    lines.push(
      await rateLine(
        channel.id,
        model,
        d.kind,
        normalized.parameters,
        undefined,
        tx,
      ),
    );
  }
  const quote = await tx.creditQuote.create({
    data: {
      teamId: actor.teamId,
      actorId: actor.userId,
      digest: batchDigest(data),
      input: json(data),
      lines: json(lines),
      amount: lines.reduce((n, l) => n.add(l.amount), new Prisma.Decimal(0)),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  return createBatch(actor, { ...data, quoteId: quote.id }, tx);
}
