import { db } from "../lib/db";
import { decrypt } from "../lib/security";
import { json } from "../lib/services";
import { assert } from "../lib/errors";
export function openRouterModel(model: string) {
  const normalized = model.replace(/^openai\//, "");
  if (normalized === "gpt-image-2.5") return "openai/gpt-image-2.5-flare";
  assert(
    ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"].includes(normalized),
    422,
    "OpenRouter 不支持该图片型号",
  );
  return "openai/" + normalized;
}
export function canUseOpenRouter(
  job: { kind: string; input: any },
  result: any,
) {
  const i = job.input;
  if (
    job.kind !== "image" ||
    (i.channel && i.channel !== "auto") ||
    i.openrouterAttempted
  )
    return false;
  try {
    openRouterModel(i.model);
  } catch {
    return false;
  }
  return (
    (result.status ?? result.state) === "failed" &&
    !result.result_url &&
    !result.result_urls?.length &&
    ![result.billed_cost, result.billed_cost_cny, result.billing?.cost].some(
      (v) => v != null && Number(v) !== 0,
    ) &&
    !/timeout|timed.out|超时|network|网络|cancel|取消|policy|moderation|安全|违规|审核/i.test(
      JSON.stringify(result.error ?? ""),
    )
  );
}
export async function openRouterRequest(
  channel: any,
  path: string,
  body?: any,
) {
  assert(
    channel.baseUrl === "https://openrouter.ai/api",
    422,
    "OpenRouter 地址须为官方 API 地址",
  );
  if (!body) {
    const id = path
      .split("/")
      .pop()!
      .replace(/^openrouter:/, "");
    const j = await db.job.findUniqueOrThrow({ where: { id } });
    assert(j.channelId === channel.id, 404, "任务不存在");
    return j.result as any;
  }
  assert(!path.endsWith("/cancel"), 409, "同步图片请求不能远端取消");
  const id = body.metadata.platform_job_id;
  const response = await fetch(channel.baseUrl + "/v1/images", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + decrypt(channel.ciphertext),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openRouterModel(body.model),
      prompt: body.prompt,
      n: 1,
      resolution: body.image_size ?? "1K",
      aspect_ratio: body.aspect_ratio ?? "1:1",
      output_format: "png",
      ...(body.reference_image_urls?.length
        ? {
            input_references: body.reference_image_urls.map((url: string) => ({
              type: "image_url",
              image_url: { url },
            })),
          }
        : {}),
    }),
    signal: AbortSignal.timeout(Number(channel.options?.timeoutMs ?? 240000)),
  });
  if (!response.ok)
    throw Object.assign(new Error(`OpenRouter HTTP ${response.status}`), {
      httpStatus: response.status,
    });
  const data = await response.json();
  assert(
    data.data?.length &&
      data.data.every((v: any) => typeof v.b64_json === "string"),
    502,
    "OpenRouter 未返回图片",
  );
  const result = {
    status: "succeeded",
    channel: "openrouter",
    model: openRouterModel(body.model),
    usage: data.usage ?? null,
    cost: { currency: "USD", amount: data.usage?.cost ?? null },
    result_urls: data.data.map(
      (v: any) => `data:${v.media_type ?? "image/png"};base64,${v.b64_json}`,
    ),
  };
  // Persist before acknowledging submission; recovery can reuse the response without repurchasing.
  await db.$transaction(async (tx) => {
    await tx.job.update({
      where: { id },
      data: {
        result: json(result),
        upstreamId: "openrouter:" + id,
        status: "running",
        phase: "poll",
        actualChannel: "openrouter",
      },
    });
    await tx.outbox.create({ data: { jobId: id, phase: "poll" } });
  });
  return { job_id: "openrouter:" + id, channel: "openrouter" };
}
