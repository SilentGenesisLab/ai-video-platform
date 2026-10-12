import { db } from "./db";
import { assert } from "./errors";
import { canonical, digest, decrypt } from "./security";
import { json } from "./services";
import {
  rateLine,
  reserveUsage,
  settleUsage,
  usageFromResult,
} from "./billing";
export async function meteredCall(
  actor: { teamId: string; userId: string },
  invocationId: string,
  channelId: string,
  kind: string,
  model: string,
  input: any,
  path = "/chat/completions",
) {
  const channel = await db.channel.findUnique({ where: { id: channelId } });
  assert(
    channel?.enabled && (channel.models as any)[kind]?.includes(model),
    422,
    "模型能力不可用",
  );
  const hash = digest(canonical({ channelId, kind, model, input, path }));
  let usage = await db.usageRecord.findUnique({ where: { invocationId } });
  if (usage) {
    assert(usage.requestHash === hash, 409, "调用标识对应的输入已改变");
    if (usage.response) return usage.response;
    assert(
      usage.status === "reserved",
      409,
      "调用结果待确认，请先对账，系统不会重复提交",
    );
  } else {
    const line = await rateLine(channelId, model, kind, {}, input);
    usage = await db.$transaction((tx) =>
      reserveUsage(tx, actor, invocationId, line, hash),
    );
  }
  const claimed = await db.usageRecord.updateMany({
    where: { id: usage.id, status: "reserved" },
    data: { status: "submitting" },
  });
  assert(claimed.count === 1, 409, "调用正在执行或等待对账");
  try {
    const response = await fetch(channel.baseUrl.replace(/\/$/, "") + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + decrypt(channel.ciphertext),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) {
      // A provider rejection is not evidence of a refund. Keep the reservation for reconciliation.
      await settleUsage(usage.id, null, "unknown", {
        httpStatus: response.status,
      });
      throw new Error("模型调用失败 HTTP " + response.status);
    }
    const result = await response.json();
    await db.usageRecord.update({
      where: { id: usage.id },
      data: { response: json(result) },
    });
    await usageFromResult(usage.id, result, true);
    return result;
  } catch (error) {
    await settleUsage(usage.id, null);
    throw error;
  }
}
