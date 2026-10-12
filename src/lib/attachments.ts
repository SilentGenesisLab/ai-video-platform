import { requirePermission } from "./permissions";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { type Actor, requireScope } from "./auth";
import { fileAccess, conversationAccess } from "./access";
import { assert } from "./errors";
import { digest, encrypt } from "./security";
import { audit, getResource, json, saveResource, type Tx } from "./services";
import { oss, objectKey } from "./storage";
import { appendEvent } from "./events";
import { adaptProductContent, materialCategory } from "./product-content";

export const VIDEO_MODEL = "doubao-seed-2-1-pro-260628";
export const VIDEO_PROMPT =
  "请仔细拆解视频的叙述逻辑、按时间顺序的结构分镜、说话内容，以及钩子、卖点、证据和行动引导等营销逻辑。区分观察、转写与推测。";
export async function createAnalysis(
  actor: Actor,
  fileId: string,
  prompt: string,
  tx: Tx = db,
) {
  requireScope(actor, "write");
  assert(
    process.env.ASSISTANT_VIDEO_ENABLED !== "false",
    503,
    "视频识别暂未启用",
  );
  requirePermission(actor, "file.analyze");
  const f = await fileAccess(actor, fileId, tx);
  assert(
    f.status === "ready" && f.mime.startsWith("video/"),
    422,
    "需要上传完成的视频",
  );
  await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id = ${fileId} FOR UPDATE`;
  const question = prompt.trim() || VIDEO_PROMPT;
  const fingerprint = digest(
    [f.id, f.sha256, VIDEO_MODEL, "video-v1", question].join("\n"),
  );
  const old = await tx.fileAnalysis.findUnique({ where: { fingerprint } });
  if (old) return old;
  const channel = await tx.channel.findFirst({
    where: { provider: "volcengine", enabled: true },
    orderBy: { createdAt: "asc" },
  });
  assert(channel, 503, "请先配置豆包视频识别渠道");
  const job = await tx.job.create({
    data: {
      kind: "video_analysis",
      phase: "analyze",
      productId: f.productId,
      conversationId: f.conversationId,
      channelId: channel.id,
      input: { fileId, prompt: question, model: VIDEO_MODEL },
    },
  });
  const analysis = await tx.fileAnalysis.create({
    data: {
      fileId,
      fingerprint,
      jobId: job.id,
      model: VIDEO_MODEL,
      prompt: question,
    },
  });
  await tx.outbox.create({ data: { jobId: job.id, phase: "analyze" } });
  await tx.fileObject.update({
    where: { id: fileId },
    data: { parseStatus: "pending", parseError: null },
  });
  await audit(tx, actor, "file.analysis_requested", analysis.id, f.productId);
  return analysis;
}
export async function prepareAttachments(
  actor: Actor,
  ids: string[],
  prompt: string,
  tx: Tx,
) {
  const jobs: string[] = [];
  for (const id of [...new Set(ids)]) {
    const f = await fileAccess(actor, id, tx);
    if (f.mime.startsWith("video/")) {
      jobs.push((await createAnalysis(actor, id, prompt, tx)).jobId);
      continue;
    }
    if (["completed", "failed", "not_required"].includes(f.parseStatus))
      continue;
    await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id = ${id} FOR UPDATE`;
    const existing = await tx.job.findFirst({
      where: {
        kind: "parse",
        input: { path: ["fileId"], equals: id },
        status: { in: ["queued", "running"] },
      },
    });
    if (existing) {
      jobs.push(existing.id);
      continue;
    }
    requirePermission(actor, "file.analyze");
    const job = await tx.job.create({
      data: {
        productId: f.productId,
        conversationId: f.conversationId,
        kind: "parse",
        phase: "parse",
        input: { fileId: id },
      },
    });
    await tx.fileObject.update({
      where: { id },
      data: { parseStatus: "pending" },
    });
    await tx.outbox.create({ data: { jobId: job.id, phase: "parse" } });
    jobs.push(job.id);
  }
  return jobs;
}
export async function importVideo(
  actor: Actor,
  conversationId: string,
  input: unknown,
  tx: Tx,
) {
  requireScope(actor, "write");
  await conversationAccess(actor, conversationId, tx);
  const { url } = z
    .object({
      url: z
        .url()
        .max(8000)
        .refine(
          (v) => new URL(v).protocol === "https:",
          "仅支持 HTTPS 视频直链",
        ),
    })
    .parse(input);
  const job = await tx.job.create({
    data: {
      kind: "import",
      phase: "import",
      conversationId,
      input: { urlCiphertext: encrypt(url), ownerId: actor.id },
    },
  });
  await audit(tx, actor, "file.import_requested", job.id);
  await appendEvent(tx, conversationId, "attachment", {
    jobId: job.id,
    status: "queued",
    text: "正在导入视频",
  });
  return tx.outbox
    .create({ data: { jobId: job.id, phase: "import" } })
    .then(() => ({ jobId: job.id }));
}
export async function saveToProduct(
  actor: Actor,
  fileId: string,
  input: unknown,
  tx: Tx,
) {
  requireScope(actor, "write");
  const { productId, baseVersion } = z
    .object({ productId: z.string(), baseVersion: z.number().int().positive() })
    .parse(input);
  const f = await fileAccess(actor, fileId, tx),
    p = await getResource(actor, productId, tx);
  assert(
    p.kind === "product" && f.status === "ready",
    422,
    "请选择有效产品及上传完成的文件",
  );
  assert(p.version === baseVersion, 409, "产品资料已更新，请刷新后重试");
  let saved = await tx.fileObject.findFirst({
    where: { productId, sourceFileId: fileId },
  });
  if (!saved) {
    const key = objectKey(f.name);
    await oss().copy(key, f.key);
    saved = await tx.fileObject.create({
      data: {
        id: randomUUID(),
        productId,
        sourceFileId: f.id,
        name: f.name,
        key,
        mime: f.mime,
        bytes: f.bytes,
        sha256: f.sha256,
        status: "ready",
        parseStatus: f.parseStatus,
        extractedText: f.extractedText,
        parseError: f.parseError,
        metadata: json(f.metadata ?? {}),
        createdBy: actor.id,
      },
    });
  }
  const content = p.content as any;
  const materials = adaptProductContent(content).materials;
  const product = await saveResource(
    actor,
    "product",
    {
      title: p.title,
      status: p.status,
      baseVersion,
      content: {
        ...content,
        fileIds: [...new Set([...(content.fileIds ?? []), saved.id])],
        materials: materials.some((m: any) => m.fileId === saved.id)
          ? materials
          : [
              ...materials,
              {
                id: randomUUID(),
                fileId: saved.id,
                title: saved.name,
                category: materialCategory(saved.mime),
                note: "来自创意助手会话",
              },
            ],
      },
    },
    tx,
    p.id,
  );
  await audit(tx, actor, "file.saved_to_product", saved.id, productId, {
    sourceFileId: fileId,
  });
  return { file: saved, product };
}
export async function readContent(
  actor: Actor,
  id: string,
  cursor = 0,
  limit = 8000,
) {
  const f = await fileAccess(actor, id);
  assert(
    Number.isInteger(cursor) &&
      cursor >= 0 &&
      Number.isInteger(limit) &&
      limit > 0 &&
      limit <= 16000,
    422,
    "无效分页",
  );
  const text = f.extractedText ?? "";
  return {
    fileId: id,
    name: f.name,
    status: f.parseStatus,
    error: f.parseError,
    text: text.slice(cursor, cursor + limit),
    cursor,
    nextCursor: cursor + limit < text.length ? cursor + limit : null,
    total: text.length,
    sections: (f.metadata as any)?.sections ?? [],
  };
}
export async function retryAnalysis(actor: Actor, fileId: string, tx: Tx) {
  requireScope(actor, "write");
  const file = await fileAccess(actor, fileId, tx);
  await tx.$queryRaw`SELECT id FROM "FileObject" WHERE id = ${fileId} FOR UPDATE`;
  const analysis = await tx.fileAnalysis.findFirst({
    where: { fileId },
    orderBy: { createdAt: "desc" },
  });
  assert(
    analysis?.status === "failed",
    409,
    "仅可重试明确失败的分析；结果不明时须先核对供应商记录",
  );
  const old = await tx.job.findUniqueOrThrow({ where: { id: analysis.jobId } });
  await tx.job.update({
    where: { id: old.id },
    data: {
      result: json({
        analysisId: analysis.id,
        error: analysis.error,
        rawResponse: analysis.rawResponse,
        usage: analysis.usage,
      }),
    },
  });
  const next = await tx.job.create({
    data: {
      productId: file.productId,
      conversationId: file.conversationId,
      kind: "video_analysis",
      phase: "analyze",
      channelId: old.channelId,
      input: json(old.input),
    },
  });
  await tx.fileAnalysis.update({
    where: { id: analysis.id },
    data: {
      jobId: next.id,
      status: "queued",
      error: null,
      rawResponse: Prisma.DbNull,
      usage: Prisma.DbNull,
      result: Prisma.DbNull,
    },
  });
  await tx.fileObject.update({
    where: { id: fileId },
    data: { parseStatus: "pending", parseError: null },
  });
  await tx.outbox.create({ data: { jobId: next.id, phase: "analyze" } });
  await audit(tx, actor, "file.analysis_retried", next.id, file.productId, {
    previousJobId: old.id,
  });
  return { jobId: next.id };
}
