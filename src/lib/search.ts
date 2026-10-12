import { meteredOperation } from "./metering";
import { z } from "zod";
import { db } from "./db";
import { type Actor, requireScope } from "./auth";
import { assert, checkProviderResponse } from "./errors";
import { decrypt, digest, canonical } from "./security";
import { json, audit } from "./services";
import { emitEvent } from "./events";
import { withChannel } from "./channel-call";
export async function webSearch(
  actor: Actor,
  input: unknown,
  key: string | null,
) {
  requireScope(actor, "write");
  requireScope(actor, "generate");
  assert(
    process.env.ASSISTANT_SEARCH_ENABLED !== "false",
    503,
    "联网搜索暂未启用",
  );
  assert(
    key && key.length >= 8 && key.length <= 200,
    400,
    "搜索需要 Idempotency-Key",
  );
  const args = z
    .object({
      query: z.string().trim().min(1).max(1500),
      freshness: z
        .enum(["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"])
        .default("noLimit"),
      count: z.number().int().min(1).max(10).default(10),
    })
    .parse(input);
  const requestKey = digest(actor.teamId + ":" + actor.id + ":" + key);
  const old = await db.searchRecord.findUnique({ where: { requestKey } });
  if (old) {
    assert(old.query === canonical(args), 409, "相同幂等键对应不同搜索");
    return (
      old.result ?? {
        status: old.status,
        message: "搜索请求已经发出；不会重复提交。",
      }
    );
  }
  const channel = await db.channel.findFirst({
    where: { provider: "bocha", enabled: true },
    orderBy: { createdAt: "asc" },
  });
  assert(channel, 503, "博查搜索渠道未配置");
  const reservation = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`;
    const existing = await tx.searchRecord.findUnique({
      where: { requestKey },
    });
    if (existing) return { record: existing, created: false };
    let conversationId: string | undefined;
    if (actor.runId) {
      const run = await tx.agentRun.findUniqueOrThrow({
        where: { id: actor.runId },
      });
      conversationId = run.conversationId;
      const accepted = await tx.agentRun.updateMany({
        where: {
          id: actor.runId,
          searchCount: {
            lt: Number((channel.options as any)?.searchLimit ?? 5),
          },
          status: "running",
          stopRequested: false,
        },
        data: { searchCount: { increment: 1 } },
      });
      assert(accepted.count, 429, "已达到本次回答的搜索上限，或运行已停止");
    }
    const record = await tx.searchRecord.create({
      data: {
        actorId: actor.id,
        runId: actor.runId,
        conversationId,
        requestKey,
        query: canonical(args),
      },
    });
    return { record, created: true };
  });
  const { record } = reservation;
  if (!reservation.created) {
    assert(record.query === canonical(args), 409, "相同幂等键对应不同搜索");
    return (
      record.result ?? {
        status: record.status,
        message: "搜索请求已经发出；不会重复提交。",
      }
    );
  }
  if (record.conversationId)
    await emitEvent(
      record.conversationId,
      "search",
      { query: args.query, status: "running", text: "正在搜索资料" },
      actor.runId,
    );
  let result: any;
  try {
    result = await withChannel(channel, async (signal) => {
      const body: any = await meteredOperation(
        actor,
        "search:" + record.id,
        channel.id,
        "search",
        "web-search",
        args,
        async () => {
          const r = await fetch(
            channel.baseUrl.replace(/\/$/, "") + "/v1/web-search",
            {
              method: "POST",
              headers: {
                Authorization: "Bearer " + decrypt(channel.ciphertext),
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ ...args, summary: true }),
              signal,
            },
          );
          checkProviderResponse(r, "博查搜索失败");
          const body = await r.json();
          assert(
            body.code === undefined || body.code === 200,
            502,
            "博查搜索返回错误，请检查渠道状态和余额",
          );
          return body;
        },
      );
      const sources = (body.data?.webPages?.value ?? [])
        .filter((s: any) => {
          try {
            return ["http:", "https:"].includes(new URL(s.url).protocol);
          } catch {
            return false;
          }
        })
        .slice(0, args.count)
        .map((s: any, i: number) => ({
          id: `${record.id}:${i + 1}`,
          title: String(s.name ?? "").slice(0, 400),
          url: s.url,
          summary: String(s.summary ?? s.snippet ?? "").slice(0, 5000),
          siteName: s.siteName ?? "",
          publishedAt: s.datePublished ?? null,
        }));
      return { status: "completed", query: args.query, sources };
    });
  } catch (e) {
    result = {
      status: "failed",
      query: args.query,
      message:
        e instanceof Error && e.name === "HttpError"
          ? e.message
          : "搜索未完成，请检查渠道或稍后使用新的请求重试。",
      sources: [],
    };
  }
  await db.searchRecord.update({
    where: { id: record.id },
    data: { status: result.status, result: json(result) },
  });
  await audit(db, actor, "search." + result.status, record.id, undefined, {
    resultCount: result.sources.length,
  });
  if (record.conversationId)
    await emitEvent(record.conversationId, "search", result, actor.runId);
  return result;
}
