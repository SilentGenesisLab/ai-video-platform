import OSS from "ali-oss";
import { randomUUID } from "node:crypto";
import { assert } from "./errors";
import { digest } from "./security";
import { db } from "./db";
import { Actor, productAccess, requireScope } from "./auth";
import { audit, getResource, json, Tx } from "./services";
import { z } from "zod";
export function oss() {
  assert(
    process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET,
    503,
    "OSS 尚未配置",
  );
  return new OSS({
    region: process.env.OSS_REGION ?? "oss-cn-beijing",
    bucket: process.env.OSS_BUCKET ?? "chorify-imgai",
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    secure: true,
    timeout: 120000,
  });
}
export function objectKey(name: string) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replaceAll("-", "");
  const safe =
    name
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}._-]/gu, "_")
      .slice(-150) || "file";
  return `${(process.env.OSS_PREFIX ?? "aivideo").replace(/^\/+|\/+$/g, "")}/${date}/${randomUUID()}/${safe}`;
}
export function readUrl(key: string, expires = 3600) {
  return oss().signatureUrl(key, { expires });
}
export const allowedMime = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/ogg",
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
export const uploadSchema = z.object({
  productId: z.string(),
  name: z.string().min(1).max(200),
  mime: z.enum(allowedMime as [string, ...string[]]),
  bytes: z
    .number()
    .int()
    .positive()
    .max(512 * 1024 * 1024),
});
export async function initiateUpload(actor: Actor, input: unknown, tx: Tx) {
  requireScope(actor, "write");
  const data = uploadSchema.parse(input);
  const product = await getResource(actor, data.productId, tx);
  assert(product.kind === "product", 422, "需要产品");
  const file = await tx.fileObject.create({
    data: { ...data, key: objectKey(data.name), createdBy: actor.id },
  });
  await audit(tx, actor, "file.upload_started", file.id, file.productId);
  return {
    file,
    uploadUrl: oss().signatureUrl(file.key, {
      method: "PUT",
      expires: 900,
      "Content-Type": file.mime,
    }),
    headers: { "Content-Type": file.mime },
  };
}
export async function completeUpload(actor: Actor, id: string) {
  requireScope(actor, "write");
  const file = await db.fileObject.findUnique({ where: { id } });
  assert(file, 404, "文件不存在");
  productAccess(actor, file.productId);
  if (file.status === "ready") return file;
  const head = await oss().head(file.key);
  const bytes = Number(
    (head.res.headers as Record<string, string>)["content-length"],
  );
  assert(bytes === file.bytes, 422, "上传文件大小不匹配");
  const result = await oss().get(file.key);
  const buffer = result.content as Buffer;
  validateMagic(buffer, file.mime);
  // Promote to a new immutable object key. An unexpired staging PUT cannot overwrite an approved asset.
  const finalKey = objectKey(file.name);
  await oss().put(finalKey, buffer, { mime: file.mime });
  return db.$transaction(async (tx) => {
    const changed = await tx.fileObject.updateMany({
      where: { id, status: "pending" },
      data: { status: "ready", sha256: digest(buffer), key: finalKey },
    });
    if (changed.count) {
      const job = await tx.job.create({
        data: {
          kind: "parse",
          productId: file.productId,
          input: { fileId: id },
        },
      });
      await tx.outbox.create({ data: { jobId: job.id, phase: "parse" } });
      await audit(tx, actor, "file.upload_completed", id, file.productId);
    }
    return tx.fileObject.findUniqueOrThrow({ where: { id } });
  });
}
export function validateMagic(buf: Buffer, mime: string) {
  const head = buf.subarray(0, 16),
    hex = head.toString("hex");
  if (mime === "image/png")
    assert(hex.startsWith("89504e470d0a1a0a"), 422, "文件内容不是 PNG");
  if (mime === "image/jpeg")
    assert(hex.startsWith("ffd8ff"), 422, "文件内容不是 JPEG");
  if (mime === "application/pdf")
    assert(head.toString().startsWith("%PDF-"), 422, "文件内容不是 PDF");
  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    assert(hex.startsWith("504b0304"), 422, "文件内容不是 DOCX");
  if (mime === "image/webp")
    assert(head.toString("ascii", 8, 12) === "WEBP", 422, "文件内容不是 WebP");
  if (mime === "image/gif")
    assert(head.toString().startsWith("GIF8"), 422, "文件内容不是 GIF");
}
export async function persistBuffer(
  productId: string,
  name: string,
  mime: string,
  buffer: Buffer,
  createdBy = "worker",
  metadata: unknown = {},
) {
  const key = objectKey(name);
  await oss().put(key, buffer, { mime });
  return db.fileObject.create({
    data: {
      productId,
      name,
      mime,
      key,
      bytes: buffer.length,
      sha256: digest(buffer),
      status: "ready",
      parseStatus: "not_required",
      createdBy,
      metadata: json(metadata),
    },
  });
}
