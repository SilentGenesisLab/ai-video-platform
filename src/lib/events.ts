import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { authenticate } from "./auth";
import { hasPermission, resourceModule } from "./permissions";
import { conversationAccess } from "./access";
import { json, type Tx } from "./services";
import { assert } from "./errors";

let publisher: Redis | undefined;
function redis() {
  if (!publisher) {
    publisher = new Redis(process.env.REDIS_URL!, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    publisher.on("error", () => {});
  }
  return publisher;
}
export async function notifyConversation(id: string) {
  try {
    await redis().publish("conversation:" + id, "changed");
  } catch {
    /* The durable cursor still recovers events. */
  }
}
export async function appendEvent(
  tx: Tx,
  conversationId: string,
  type: string,
  data: unknown,
  runId?: string,
  eventKey: string = randomUUID(),
) {
  // All event writers hold this lock so committed cursor order cannot overtake an earlier transaction.
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId} FOR UPDATE`;
  const conversation = await tx.conversation.findUniqueOrThrow({
    where: { id: conversationId },
  });
  const event = await tx.agentEvent.upsert({
    where: { eventKey },
    create: {
      teamId: conversation.teamId,
      conversationId,
      runId,
      eventKey,
      type,
      data: json(data),
    },
    update: {},
  });
  return { ...event, seq: event.seq.toString() };
}
export async function emitEvent(
  conversationId: string,
  type: string,
  data: unknown,
  runId?: string,
  eventKey?: string,
) {
  const e = await db.$transaction((tx) =>
    appendEvent(tx, conversationId, type, data, runId, eventKey),
  );
  void notifyConversation(conversationId);
  return e;
}
export async function conversationEvents(req: Request, id: string) {
  assert(
    process.env.ASSISTANT_STREAM_ENABLED !== "false",
    503,
    "流式连接暂未启用",
  );
  await conversationAccess(await authenticate(req), id);
  const after =
    req.headers.get("last-event-id") ||
    new URL(req.url).searchParams.get("after") ||
    "0";
  assert(
    /^\d{1,19}$/.test(after) && BigInt(after) <= 9223372036854775807n,
    422,
    "无效事件游标",
  );
  let cursor = BigInt(after),
    closed = false,
    busy = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let sub: Redis | undefined;
  const encoder = new TextEncoder();
  const cleanup = () => {
    closed = true;
    if (timer) clearInterval(timer);
    sub?.disconnect();
    req.signal.removeEventListener("abort", cleanup);
  };
  const stream = new ReadableStream({
    start(controller) {
      const send = (value: string) => {
        if (!closed) controller.enqueue(encoder.encode(value));
      };
      const pump = async () => {
        if (closed || busy) return;
        busy = true;
        try {
          const actor = await authenticate(req);
          await conversationAccess(actor, id);
          let more = true;
          while (more && !closed) {
            const events = await db.agentEvent.findMany({
              where: { conversationId: id, seq: { gt: cursor } },
              orderBy: { seq: "asc" },
              take: 200,
            });
            for (const original of events) {
              const e = { ...original };
              if (actor.type === "agent") {
                const data = e.data as any;
                if (
                  e.type === "attachment" &&
                  !hasPermission(actor, "file.read")
                ) {
                  cursor = e.seq;
                  continue;
                }
                if (e.type === "message" && data && typeof data === "object")
                  e.data = {
                    ...data,
                    attachmentIds: hasPermission(actor, "file.read")
                      ? data.attachmentIds
                      : [],
                    contextRefs: (Array.isArray(data.contextRefs)
                      ? data.contextRefs
                      : []
                    ).filter(
                      (r: any) =>
                        hasPermission(
                          actor,
                          resourceModule(r.kind) + ".read",
                        ) &&
                        (!actor.productIds.length ||
                          actor.productIds.includes(r.productId)),
                    ),
                  };
              }
              send(
                `id: ${e.seq}\nevent: update\ndata: ${JSON.stringify({ ...e, seq: e.seq.toString() })}\n\n`,
              );
              cursor = e.seq;
            }
            more = events.length === 200;
          }
          send(": heartbeat\n\n");
        } catch {
          send(
            'event: access-error\ndata: {"message":"连接不可用，请重新验证会话"}\n\n',
          );
          cleanup();
          controller.close();
        } finally {
          busy = false;
        }
      };
      send("retry: 1500\n\n");
      sub = new Redis(process.env.REDIS_URL!, {
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      });
      sub.on("error", () => {});
      sub.on("message", () => void pump());
      void sub.subscribe("conversation:" + id).catch(() => {});
      timer = setInterval(() => void pump(), 1500);
      req.signal.addEventListener("abort", cleanup, { once: true });
      void pump();
    },
    cancel: cleanup,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
