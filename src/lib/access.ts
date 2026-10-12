import { db } from "./db";
import { type Actor, productAccess, requireScope } from "./auth";
import { assert } from "./errors";
import type { Tx } from "./services";

export async function conversationAccess(
  actor: Actor,
  id: string,
  tx: Tx = db,
) {
  requireScope(actor, "read");
  const c = await tx.conversation.findUnique({ where: { id } });
  assert(c, 404, "会话不存在");
  assert(
    c.ownerId === actor.userId ||
      (actor.type === "human" && actor.role === "admin"),
    403,
    "无权查看此会话",
  );
  productAccess(actor, c.productId);
  if (actor.runId) {
    const run = await tx.agentRun.findUnique({ where: { id: actor.runId } });
    assert(run?.conversationId === id, 403, "运行仅可访问当前会话");
  }
  return c;
}
export async function scopedAccess(
  actor: Actor,
  item: { productId: string | null; conversationId?: string | null },
  tx: Tx = db,
) {
  requireScope(actor, "read");
  if (item.conversationId)
    await conversationAccess(actor, item.conversationId, tx);
  else {
    assert(item.productId, 403, "对象缺少有效归属");
    productAccess(actor, item.productId);
  }
}
export async function fileAccess(actor: Actor, id: string, tx: Tx = db) {
  const file = await tx.fileObject.findUnique({ where: { id } });
  assert(file, 404, "文件不存在");
  await scopedAccess(actor, file, tx);
  return file;
}
export async function scopedFilter(actor: Actor) {
  if (actor.type === "human" && actor.role === "admin") return {};
  const conversations = await db.conversation.findMany({
    where: {
      ownerId: actor.userId,
      ...(actor.productIds.length
        ? { productId: { in: actor.productIds } }
        : {}),
      ...(actor.runId ? { runs: { some: { id: actor.runId } } } : {}),
    },
    select: { id: true },
  });
  return {
    OR: [
      {
        conversationId: null,
        productId: actor.productIds.length
          ? { in: actor.productIds }
          : { not: null },
      },
      { conversationId: { in: conversations.map((c) => c.id) } },
    ],
  };
}
