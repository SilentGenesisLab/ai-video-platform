import { Prisma } from "@prisma/client";
import { systemDb } from "./db";
import type { Tx } from "./services";
import { assert } from "./errors";
import { Actor, requireHuman, requirePlatform } from "./auth";
import { z } from "zod";
const D = Prisma.Decimal;
export async function payerUser(tx: Tx, identifier: string, teamId: string) {
  const direct = await tx.user.findUnique({ where: { id: identifier } });
  const key = direct
    ? null
    : await tx.apiKey.findUnique({ where: { id: identifier } });
  const run =
    direct || key
      ? null
      : await tx.agentRun.findUnique({ where: { id: identifier } });
  if (key)
    assert(
      key.teamId === teamId &&
        key.enabled &&
        !key.revokedAt &&
        (!key.expiresAt || key.expiresAt > new Date()),
      403,
      "付款人的 API Key 已失效",
    );
  if (run) assert(run.teamId === teamId, 403, "运行团队不匹配");
  const user =
    direct ??
    (await tx.user.findUnique({
      where: { id: key?.ownerId ?? run?.ownerId ?? "missing" },
    }));
  assert(user?.active, 403, "付款账号已停用");
  const member = await tx.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } },
  });
  const team = await tx.team.findUnique({ where: { id: teamId } });
  assert(member?.active && team && !team.archived, 403, "付款人不在有效团队中");
  return user.id;
}
export async function lockPersonal(tx: Tx, userId: string) {
  await tx.userWallet.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  await tx.$queryRaw`SELECT id FROM "UserWallet" WHERE "userId"=${userId} FOR UPDATE`;
  return tx.userWallet.findUniqueOrThrow({ where: { userId } });
}
export async function allocateCredits(
  a: Actor,
  teamId: string,
  input: unknown,
) {
  requireHuman(a);
  const d = z
    .object({
      userId: z.string(),
      amount: z.coerce.number().positive().max(1e9),
      reason: z.string().min(3).max(500),
      eventKey: z.string().min(8).max(200),
    })
    .parse(input);
  return systemDb.$transaction(async (tx) => {
    // Membership row locks serialize allocation against concurrent member changes.
    await tx.$queryRaw`SELECT id FROM "TeamMember" WHERE "teamId"=${teamId} AND "userId" IN (${a.userId},${d.userId}) ORDER BY id FOR UPDATE`;
    const member = await tx.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: a.userId } },
    });
    assert(
      a.platformAdmin ||
        (member?.active && ["owner", "admin"].includes(member.role)),
      403,
      "需要团队管理权限",
    );
    const target = await tx.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: d.userId } },
    });
    const user = await tx.user.findUnique({ where: { id: d.userId } }),
      team = await tx.team.findUnique({ where: { id: teamId } });
    assert(
      target?.active && user?.active && team && !team.archived,
      422,
      "只能分配给有效团队成员",
    );
    await tx.$queryRaw`SELECT id FROM "Wallet" WHERE "teamId"=${teamId} FOR UPDATE`;
    const w = await tx.wallet.findUniqueOrThrow({ where: { teamId } }),
      personal = await lockPersonal(tx, d.userId);
    const eventKey = "allocation:" + teamId + ":" + d.eventKey;
    const old = await tx.personalCreditLedger.findUnique({
      where: { eventKey },
    });
    if (old) {
      assert(
        old.userId === d.userId &&
          old.amount.eq(d.amount) &&
          old.reason === d.reason,
        409,
        "重复请求内容不同",
      );
      return old;
    }
    assert(
      w.balance.sub(w.frozen).gte(d.amount),
      402,
      "团队公共池可用积分不足",
    );
    await tx.wallet.update({
      where: { id: w.id },
      data: { balance: { decrement: d.amount } },
    });
    await tx.userWallet.update({
      where: { id: personal.id },
      data: { balance: { increment: d.amount } },
    });
    await tx.creditLedger.create({
      data: {
        teamId,
        eventKey,
        actorId: a.userId,
        kind: "allocation",
        amount: new D(d.amount).neg(),
        reason: d.reason,
        referenceId: d.userId,
      },
    });
    const result = await tx.personalCreditLedger.create({
      data: {
        userId: d.userId,
        sourceTeamId: teamId,
        eventKey,
        actorId: a.userId,
        kind: "allocation",
        amount: d.amount,
        reason: d.reason,
      },
    });
    await tx.auditEvent.create({
      data: {
        teamId,
        actorId: a.userId,
        actorType: "human",
        action: "credits.allocated",
        entityId: d.userId,
        data: { amount: d.amount, reason: d.reason },
      },
    });
    return result;
  });
}
export async function adjustPersonal(a: Actor, input: unknown) {
  requirePlatform(a);
  const d = z
    .object({
      userId: z.string(),
      amount: z.coerce
        .number()
        .refine((v) => Number.isFinite(v) && v !== 0 && Math.abs(v) <= 1e9),
      reason: z.string().min(3).max(500),
      eventKey: z.string().min(8).max(200),
    })
    .parse(input);
  return systemDb.$transaction(async (tx) => {
    const w = await lockPersonal(tx, d.userId),
      eventKey = "personal-adjust:" + d.eventKey;
    const old = await tx.personalCreditLedger.findUnique({
      where: { eventKey },
    });
    if (old) {
      assert(
        old.userId === d.userId &&
          old.amount.eq(d.amount) &&
          old.reason === d.reason,
        409,
        "重复请求内容不同",
      );
      return old;
    }
    assert(
      w.balance.add(d.amount).gte(w.frozen),
      409,
      "调整后余额不能低于冻结额",
    );
    await tx.userWallet.update({
      where: { id: w.id },
      data: { balance: { increment: d.amount } },
    });
    const result = await tx.personalCreditLedger.create({
      data: {
        userId: d.userId,
        eventKey,
        actorId: a.userId,
        kind: "adjust",
        amount: d.amount,
        reason: d.reason,
      },
    });
    await tx.auditEvent.create({
      data: {
        teamId: a.teamId,
        actorId: a.userId,
        actorType: "human",
        action: "credits.personal_adjusted",
        entityId: d.userId,
        data: { amount: d.amount, reason: d.reason },
      },
    });
    return result;
  });
}
