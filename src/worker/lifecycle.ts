import { db } from "../lib/db";
import { assert } from "../lib/errors";
import { json } from "../lib/services";
import { redact } from "../lib/security";

/** Serialize slot reservation across workers and hosts, not just within one process. */
export async function reserveSubmission(
  jobId: string,
  channelId: string,
  baseUrl: string,
  path: string,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Channel" WHERE id = ${channelId} FOR UPDATE`;
    const channel = await tx.channel.findUniqueOrThrow({
      where: { id: channelId },
    });
    assert(
      channel.enabled && channel.baseUrl === baseUrl,
      409,
      "渠道已停用或地址已改变，请重新创建批次",
    );
    const active = await tx.job.count({
      where: { channelId, status: { in: ["submitting", "running"] } },
    });
    if (active >= channel.concurrency) return false;
    const result = await tx.job.updateMany({
      where: {
        id: jobId,
        status: "queued",
        upstreamId: null,
        cancelRequested: false,
      },
      data: { status: "submitting", phase: "submit", providerPath: path },
    });
    return result.count === 1;
  });
}

/** Store only the fields needed for retrieval; signed result URLs must stay intact internally. */
export function providerResult(result: any) {
  const cost =
    typeof result.billed_cost === "number"
      ? {
          type: "actual",
          amount: result.billed_cost,
          currency: result.currency ?? null,
        }
      : { type: "unknown", amount: null, currency: null };
  return json({
    status: result.status ?? result.state,
    result_urls:
      result.result_urls ?? (result.result_url ? [result.result_url] : []),
    channel: result.channel ?? null,
    upstream_task_id: result.upstream_task_id ?? null,
    error: redact(result.error ?? null),
    usage: result.usage ?? null,
    cost,
  });
}
