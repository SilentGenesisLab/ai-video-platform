import { db } from "../lib/db";
import { decrypt } from "../lib/security";
import { readUrl } from "../lib/storage";
import { assert } from "../lib/errors";
export async function providerRequest(
  channelId: string,
  path: string,
  body?: unknown,
  expectedBase?: string,
) {
  const channel = await db.channel.findUniqueOrThrow({
    where: { id: channelId },
  });
  assert(
    channel.enabled || body === undefined || path.endsWith("/cancel"),
    409,
    "渠道已停用",
  );
  assert(
    !expectedBase || channel.baseUrl === expectedBase,
    409,
    "渠道地址与提交快照不同，请恢复原地址以查询既有任务",
  );
  const response = await fetch(channel.baseUrl.replace(/\/$/, "") + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + decrypt(channel.ciphertext),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response
    .json()
    .catch(() => ({ error: "Invalid provider response" }));
  if (!response.ok)
    throw Object.assign(
      new Error(
        `Provider HTTP ${response.status}: ${JSON.stringify(result).slice(0, 1500)}`,
      ),
      { httpStatus: response.status },
    );
  return result;
}
export function providerPath(kind: string) {
  return `/v1/${kind === "image" ? "image" : kind === "video" ? "video" : "audio"}-generations/jobs`;
}
export function generationPayload(job: {
  id: string;
  kind: string;
  input: unknown;
}) {
  const input = job.input as any;
  const references = input.references ?? [];
  const body: Record<string, unknown> = {
    model: input.fallbackModel ?? input.model,
    channel: input.fallbackChannel ?? input.channel ?? "auto",
    prompt: input.prompt,
    ...input.parameters,
    external_ref: input.channelAttempts?.length
      ? `${job.id}:fallback:${input.channelAttempts.length}`
      : job.id,
    metadata: { platform_job_id: job.id },
  };
  if (job.kind === "image" || job.kind === "video")
    body.reference_image_urls = references
      .filter((f: any) => f.mime.startsWith("image/"))
      .map((f: any) => readUrl(f.key, 7200));
  if (job.kind === "video") {
    body.reference_video_urls = references
      .filter((f: any) => f.mime.startsWith("video/"))
      .map((f: any) => readUrl(f.key, 7200));
    body.reference_audio_urls = references
      .filter((f: any) => f.mime.startsWith("audio/"))
      .map((f: any) => readUrl(f.key, 7200));
  }
  if (job.kind === "audio" && input.model === "suno-sound")
    body.tags = input.parameters.tags || input.prompt;
  return body;
}
export async function downloadResult(url: string) {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    const hosts = (
      process.env.RESULT_ALLOWED_HOSTS ??
      "oss-imgai.sligenai.cn,file5.aitohumanize.com"
    )
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    assert(
      current.protocol === "https:" &&
        !current.username &&
        !current.password &&
        (current.hostname.endsWith(".aliyuncs.com") ||
          hosts.includes(current.hostname)),
      422,
      "供应商结果地址未列入 RESULT_ALLOWED_HOSTS",
    );
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(120000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      assert(location, 502, "无效结果跳转");
      current = new URL(location, current);
      continue;
    }
    assert(res.ok, 502, `结果下载失败 ${res.status}`);
    const limit = 512 * 1024 * 1024;
    assert(
      Number(res.headers.get("content-length") ?? 0) <= limit,
      413,
      "结果文件过大",
    );
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of res.body as any) {
      total += chunk.length;
      assert(total <= limit, 413, "结果文件过大");
      chunks.push(chunk);
    }
    return {
      buffer: Buffer.concat(chunks),
      mime:
        res.headers.get("content-type")?.split(";")[0] ??
        "application/octet-stream",
    };
  }
  throw new Error("结果跳转次数超限");
}
