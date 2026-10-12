import { z } from "zod";
import { db } from "./db";
import { Actor, agentScopes, productAccess, requireScope, roles } from "./auth";
import { audit, getResource, Tx } from "./services";
import { assert } from "./errors";
import { decrypt, digest, encrypt, randomToken } from "./security";
export async function createConversation(actor: Actor, input: unknown, tx: Tx) {
  requireScope(actor, "write");
  const data = z
    .object({
      title: z.string().min(1).max(200).default("新对话"),
      productId: z.string().optional(),
      planId: z.string().optional(),
    })
    .parse(input);
  productAccess(actor, data.productId);
  if (data.productId) {
    const p = await getResource(actor, data.productId, tx);
    assert(p.kind === "product", 422, "无效产品");
  }
  if (data.planId) {
    const p = await getResource(actor, data.planId, tx);
    assert(
      p.kind === "plan" && p.productId === data.productId,
      422,
      "无效策划案",
    );
  }
  return tx.conversation.create({ data: { ...data, ownerId: actor.userId } });
}
export async function conversationAccess(
  actor: Actor,
  id: string,
  tx: Tx = db,
) {
  const conversation = await tx.conversation.findUnique({ where: { id } });
  assert(conversation, 404, "会话不存在");
  assert(
    conversation.ownerId === actor.userId || actor.role === "admin",
    403,
    "无权查看此会话",
  );
  productAccess(actor, conversation.productId);
  return conversation;
}
export async function sendMessage(
  actor: Actor,
  id: string,
  input: unknown,
  tx: Tx,
) {
  requireScope(actor, "write");
  const { text } = z
    .object({ text: z.string().min(1).max(30000) })
    .parse(input);
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${id} FOR UPDATE`;
  const conversation = await conversationAccess(actor, id, tx);
  const active = await tx.agentRun.findFirst({
    where: { conversationId: id, status: { in: ["queued", "running"] } },
  });
  assert(!active, 409, "此会话正在执行，请等待或停止当前任务");
  await tx.message.create({ data: { conversationId: id, role: "user", text } });
  const token = randomToken("avr_");
  const run = await tx.agentRun.create({
    data: {
      conversationId: id,
      ownerId: actor.userId,
      sourceKeyId: actor.keyId,
      prompt: text,
      tokenHash: digest(token),
      tokenCiphertext: encrypt(token),
      scopes: actor.scopes.filter((s) => agentScopes.includes(s)),
      productIds: conversation.productId
        ? [conversation.productId]
        : actor.productIds,
    },
  });
  await audit(tx, actor, "agent.queued", run.id, conversation.productId);
  return { id: run.id, status: run.status, conversationId: id };
}
export async function controlRun(actor: Actor, id: string, action: string) {
  requireScope(actor, "write");
  return db.$transaction(async (tx) => {
    const run = await tx.agentRun.findUnique({ where: { id } });
    assert(run, 404, "运行不存在");
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${run.conversationId} FOR UPDATE`;
    await conversationAccess(actor, run.conversationId, tx);
    if (action === "stop") {
      await tx.agentRun.update({
        where: { id },
        data: { stopRequested: true, status: "stopped", leaseUntil: null },
      });
    } else {
      assert(
        ["paused", "stopped", "failed"].includes(run.status),
        409,
        "当前运行不能继续",
      );
      assert(
        !(await tx.agentRun.findFirst({
          where: {
            conversationId: run.conversationId,
            status: { in: ["queued", "running"] },
          },
        })),
        409,
        "会话已有运行",
      );
      const token = randomToken("avr_");
      await tx.agentRun.update({
        where: { id },
        data: {
          status: "queued",
          stopRequested: false,
          leaseUntil: null,
          error: null,
          tokenHash: digest(token),
          tokenCiphertext: encrypt(token),
        },
      });
    }
    await audit(tx, actor, "agent." + action, id);
    return { id, action };
  });
}
export async function claimRun() {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "AgentRun" WHERE "stopRequested" = false AND (status = 'queued' OR (status = 'running' AND "leaseUntil" < NOW())) ORDER BY "createdAt" ASC FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!rows.length) return null;
    const claimedToken = randomToken("avr_");
    const run = await tx.agentRun.update({
      where: { id: rows[0].id },
      data: {
        status: "running",
        leaseUntil: new Date(Date.now() + 90000),
        tokenHash: digest(claimedToken),
        tokenCiphertext: encrypt(claimedToken),
      },
      include: {
        conversation: {
          include: { messages: { orderBy: { createdAt: "desc" }, take: 50 } },
        },
      },
    });
    run.conversation.messages.reverse();
    const owner = await tx.user.findUnique({ where: { id: run.ownerId } });
    const membership = await tx.teamMember.findUnique({
      where: { teamId_userId: { teamId: run.teamId, userId: run.ownerId } },
    });
    const team = await tx.team.findUnique({ where: { id: run.teamId } });
    if (!owner?.active || !membership?.active || team?.archived) {
      await tx.agentRun.update({
        where: { id: run.id },
        data: { status: "failed", error: "所属账号不可用" },
      });
      return null;
    }
    const channel = await tx.channel.findFirst({
      where: { provider: "deepseek", enabled: true },
    });
    assert(channel, 503, "DeepSeek 渠道未配置");
    return {
      id: run.id,
      prompt: run.prompt,
      conversationId: run.conversationId,
      productId: run.conversation.productId,
      planId: run.conversation.planId,
      messages: run.conversation.messages,
      token: decrypt(run.tokenCiphertext),
      model: {
        channelId: channel.id,
        model: (channel.models as any).text?.[0] ?? "deepseek-flash",
      },
      scopes: run.scopes.filter((s) =>
        (roles[membership.role] ?? []).includes(s),
      ),
    };
  });
}
