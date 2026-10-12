import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import type { Channel } from "@prisma/client";
import { assert } from "./errors";
let connection: Redis;
export async function withChannel<T>(
  channel: Channel,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  assert(channel.enabled, 503, "渠道已停用");
  const timeout = Number((channel.options as any)?.timeoutMs ?? 180000);
  if (!connection) {
    connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
    connection.on("error", () => {});
  }
  const key = `assistant-channel:${channel.id}`,
    token = randomUUID(),
    now = Date.now();
  const acquired = await connection.eval(
    `redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); if redis.call('ZCARD',KEYS[1]) >= tonumber(ARGV[2]) then return 0 end; redis.call('ZADD',KEYS[1],ARGV[3],ARGV[4]); redis.call('PEXPIRE',KEYS[1],ARGV[5]); return 1`,
    1,
    key,
    now,
    channel.concurrency,
    now + timeout + 30000,
    token,
    timeout + 60000,
  );
  assert(acquired === 1, 429, "渠道繁忙，请稍后重试");
  try {
    return await fn(AbortSignal.timeout(timeout));
  } finally {
    await connection.zrem(key, token).catch(() => {});
  }
}
