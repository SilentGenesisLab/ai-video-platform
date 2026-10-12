import { randomUUID } from "node:crypto";
import { z } from "zod";
import { systemDb as db } from "./db";
import { Actor, requireHuman, requireScope, requirePlatform } from "./auth";
import { assert } from "./errors";
import { digest, randomToken } from "./security";
import { phoneNumber } from "./sms";
import type { Tx } from "./services";
export async function createTeam(
  tx: Tx,
  userId: string,
  name: string,
  grant = false,
) {
  const t = await tx.team.create({ data: { name, createdBy: userId } });
  await tx.teamMember.create({ data: { teamId: t.id, userId, role: "owner" } });
  await tx.wallet.create({ data: { teamId: t.id, balance: grant ? 1000 : 0 } });
  if (grant)
    await tx.creditLedger.create({
      data: {
        teamId: t.id,
        eventKey: "signup:" + userId,
        actorId: userId,
        kind: "grant",
        amount: 1000,
        reason: "首次注册赠送",
      },
    });
  return t;
}
async function access(a: Actor, id: string, admin = false) {
  const m = await db.teamMember.findUnique({
    where: { teamId_userId: { teamId: id, userId: a.userId } },
  });
  assert(m?.active, 403, "无权访问此团队");
  if (admin)
    assert(["owner", "admin"].includes(m.role), 403, "需要团队管理权限");
  return m;
}
export async function teamRoute(
  a: Actor,
  parts: string[],
  method: string,
  body: any,
) {
  requireHuman(a);
  const [group, id, action, memberId] = parts;
  if (group === "invitations") {
    const inv = await db.teamInvitation.findUnique({
      where: { hash: digest(id) },
    });
    assert(
      inv && !inv.revokedAt && !inv.acceptedAt && inv.expiresAt > new Date(),
      410,
      "邀请已失效",
    );
    const team = await db.team.findUnique({ where: { id: inv.teamId } });
    assert(team && !team.archived, 410, "团队已归档");
    const u = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    assert(
      u.phone === inv.phone,
      403,
      "请用收到邀请的手机号登录或先绑定该手机号",
    );
    if (method === "GET") return { teamName: team.name, role: inv.role };
    if (method === "POST")
      return db.$transaction(async (tx) => {
        const updated = await tx.teamInvitation.updateMany({
          where: {
            id: inv.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { acceptedAt: new Date() },
        });
        assert(updated.count === 1, 409, "邀请已使用");
        const old = await tx.teamMember.findUnique({
          where: { teamId_userId: { teamId: inv.teamId, userId: a.userId } },
        });
        if (!old?.active)
          await tx.teamMember.upsert({
            where: { teamId_userId: { teamId: inv.teamId, userId: a.userId } },
            create: { teamId: inv.teamId, userId: a.userId, role: inv.role },
            update: { active: true, role: inv.role },
          });
        return { teamId: team.id, accepted: true };
      });
  }
  if (group !== "teams") return undefined;
  if (!id && method === "GET") {
    const memberships = await db.teamMember.findMany({
      where: { userId: a.userId, active: true },
      orderBy: { createdAt: "asc" },
    });
    const teams = await db.team.findMany({
      where: { id: { in: memberships.map((m) => m.teamId) } },
    });
    const wallets = await db.wallet.findMany({
      where: { teamId: { in: teams.map((t) => t.id) } },
    });
    return {
      items: teams.map((t) => ({
        ...t,
        role: memberships.find((m) => m.teamId === t.id)!.role,
        wallet: wallets.find((w) => w.teamId === t.id),
      })),
      currentTeamId: a.teamId,
    };
  }
  if (!id && method === "POST")
    return db.$transaction((tx) =>
      createTeam(
        tx,
        a.userId,
        z.string().trim().min(1).max(80).parse(body.name),
      ),
    );
  const m = await access(a, id, method !== "GET" && action !== "switch");
  const team = await db.team.findUniqueOrThrow({ where: { id } });
  if (action === "switch" && method === "POST") {
    assert(!team.archived && a.sessionId, 409, "无法切换到此团队");
    await db.session.update({
      where: { id: a.sessionId },
      data: { teamId: id },
    });
    return { teamId: id };
  }
  if (!action && method === "PATCH") {
    if (body.archived === true) {
      assert(m.role === "owner", 403, "仅所有者可以归档团队");
      const others = await db.teamMember.findMany({
        where: { userId: a.userId, active: true, teamId: { not: id } },
      });
      assert(
        await db.team.count({
          where: { id: { in: others.map((m) => m.teamId) }, archived: false },
        }),
        409,
        "请先创建或加入另一个可用团队",
      );
      return db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT id FROM "Wallet" WHERE "teamId"=${id} FOR UPDATE`;
        const [jobs, runs, batches, w] = await Promise.all([
          tx.job.count({
            where: {
              teamId: id,
              status: { notIn: ["succeeded", "failed", "cancelled"] },
            },
          }),
          tx.agentRun.count({
            where: { teamId: id, status: { in: ["queued", "running"] } },
          }),
          tx.productionBatch.count({
            where: { teamId: id, status: "pending_approval" },
          }),
          tx.wallet.findUniqueOrThrow({ where: { teamId: id } }),
        ]);
        assert(
          !jobs && !runs && !batches && w.frozen.equals(0),
          409,
          "请先处理未完成任务、审批和冻结积分",
        );
        return tx.team.update({ where: { id }, data: { archived: true } });
      });
    }
    assert(!team.archived, 409, "团队已归档");
    return db.team.update({
      where: { id },
      data: { name: z.string().trim().min(1).max(80).parse(body.name) },
    });
  }
  if (action === "members") {
    if (method === "GET") {
      const members = await db.teamMember.findMany({ where: { teamId: id } }),
        users = await db.user.findMany({
          where: { id: { in: members.map((m) => m.userId) } },
          select: { id: true, name: true, email: true, phone: true },
        });
      return {
        items: members.map((m) => ({
          ...m,
          user: users.find((u) => u.id === m.userId),
        })),
      };
    }
    if (method === "PATCH" && memberId) {
      const old = await db.teamMember.findUnique({ where: { id: memberId } });
      assert(old && old.teamId === id, 404, "成员不存在");
      assert(
        old.role !== "owner" && old.userId !== a.userId,
        403,
        "不能移除所有者或修改自己的权限",
      );
      const role = z
        .enum(["admin", "editor", "reviewer", "viewer"])
        .optional()
        .parse(body.role);
      assert(
        m.role === "owner" || (old.role !== "admin" && role !== "admin"),
        403,
        "只有所有者可以任命或调整管理员",
      );
      return db.teamMember.update({
        where: { id: memberId },
        data: {
          ...(role ? { role } : {}),
          ...(typeof body.active === "boolean" ? { active: body.active } : {}),
        },
      });
    }
  }
  if (action === "invitations") {
    await access(a, id, true);
    if (method === "GET")
      return {
        items: await db.teamInvitation.findMany({
          where: { teamId: id },
          select: {
            id: true,
            phone: true,
            role: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
          },
        }),
      };
    if (method === "POST") {
      assert(!team.archived, 409, "团队已归档");
      const phone = phoneNumber(body.phone),
        role = z
          .enum(["admin", "editor", "reviewer", "viewer"])
          .default("editor")
          .parse(body.role);
      assert(
        role !== "admin" || m.role === "owner",
        403,
        "只有所有者可以邀请管理员",
      );
      const token = randomToken("invite_");
      const inv = await db.teamInvitation.create({
        data: {
          teamId: id,
          phone,
          role,
          hash: digest(token),
          createdBy: a.userId,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      return {
        id: inv.id,
        url: (process.env.APP_URL ?? "") + "/invite/" + token,
        expiresAt: inv.expiresAt,
      };
    }
    if (method === "DELETE" && memberId) {
      await db.teamInvitation.updateMany({
        where: { id: memberId, teamId: id, acceptedAt: null },
        data: { revokedAt: new Date() },
      });
      return { ok: true };
    }
  }
  return undefined;
}
