import { db } from "./db";
import { assert } from "./errors";
import { canonical, decrypt, digest } from "./security";
import { json } from "./services";
import {
  rateLine,
  reserveUsage,
  settleUsage,
  usageFromResult,
} from "./billing";

/** Internal SSE proxy: reserve once, forward tokens immediately, settle after DONE. */
export async function meteredStream(
  actor: { teamId: string; userId: string },
  invocationId: string,
  channelId: string,
  input: any,
) {
  const channel = await db.channel.findUnique({ where: { id: channelId } });
  assert(
    channel?.enabled && (channel.models as any).text?.includes(input.model),
    422,
    "文本模型不可用",
  );
  const hash = digest(canonical({ channelId, input, stream: true }));
  let usage = await db.usageRecord.findUnique({ where: { invocationId } });
  const headers = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  };
  if (usage) {
    assert(usage.requestHash === hash, 409, "调用标识对应的输入已改变");
    const saved = usage.response as any;
    if (saved?.sse) return new Response(saved.sse, { headers });
    assert(
      usage.status === "reserved",
      409,
      "调用结果待确认，请先对账，系统不会重复提交",
    );
  } else {
    const line = await rateLine(channelId, input.model, "text", {}, input);
    usage = await db.$transaction((tx) =>
      reserveUsage(tx, actor, invocationId, line, hash),
    );
  }
  const claimed = await db.usageRecord.updateMany({
    where: { id: usage.id, status: "reserved" },
    data: { status: "submitting" },
  });
  assert(claimed.count === 1, 409, "调用正在执行或等待对账");
  const usageId = usage.id;
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 180000);
  let upstream: Response;
  try {
    upstream = await fetch(
      channel.baseUrl.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + decrypt(channel.ciphertext),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...input,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: abort.signal,
      },
    );
    assert(
      upstream.ok && upstream.body,
      502,
      "模型流式调用失败 HTTP " + upstream.status,
    );
  } catch (e) {
    clearTimeout(timeout);
    await settleUsage(usageId, null);
    throw e;
  }
  let cancelled = false;
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader(),
          decoder = new TextDecoder();
        let raw = "",
          pending = "",
          done = false,
          result: any = {};
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            const text = decoder.decode(part.value, { stream: true });
            raw += text;
            pending += text;
            assert(raw.length <= 32 * 1024 * 1024, 502, "模型响应过大");
            let newline: number;
            while ((newline = pending.indexOf("\n")) >= 0) {
              const line = pending.slice(0, newline).trim();
              pending = pending.slice(newline + 1);
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (data === "[DONE]") {
                done = true;
                continue;
              }
              if (!data) continue;
              const chunk = JSON.parse(data);
              assert(!chunk.error, 502, "模型流返回错误");
              if (chunk.usage) result = { id: chunk.id, usage: chunk.usage };
            }
            if (!cancelled) controller.enqueue(part.value);
          }
          assert(done, 502, "模型流意外中断");
          await db.usageRecord.update({
            where: { id: usageId },
            data: { response: json({ ...result, sse: raw }) },
          });
          await usageFromResult(usageId, result, true);
          if (!cancelled) controller.close();
        } catch (e) {
          await settleUsage(usageId, null);
          if (!cancelled) controller.error(e);
        } finally {
          clearTimeout(timeout);
          reader.releaseLock();
        }
      },
      cancel() {
        cancelled = true;
        abort.abort();
      },
    }),
    { headers },
  );
}
