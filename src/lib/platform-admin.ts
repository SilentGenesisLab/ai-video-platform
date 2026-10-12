import { systemDb as db } from "./db";
import { Actor, requireHuman, requirePlatform } from "./auth";
import { assert } from "./errors";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { allocateCredits, adjustPersonal } from "./personal-credits";
import { createTeam } from "./teams";
const userSelect = {
  id: true,
  email: true,
  phone: true,
  name: true,
  active: true,
  platformAdmin: true,
  createdAt: true,
};
export async function adminRoute(
  a: Actor,
  parts: string[],
  method: string,
  body: any,
  params: URLSearchParams,
) {
  const [group, id, action, extra] = parts;
  if (
    group === "teams" &&
    action === "members" &&
    method === "GET" &&
    a.platformAdmin
  ) {
    requireHuman(a);
    const members = await db.teamMember.findMany({ where: { teamId: id } }),
      users = await db.user.findMany({
        where: { id: { in: members.map((m) => m.userId) } },
        select: userSelect,
      });
    return {
      items: members.map((m) => ({
        ...m,
        user: users.find((u) => u.id === m.userId),
      })),
    };
  }
  if (group === "teams" && action === "credit-allocations") {
    if (method === "POST") return allocateCredits(a, id, body);
    requireHuman(a);
    const m = await db.teamMember.findUnique({
      where: { teamId_userId: { teamId: id, userId: a.userId } },
    });
    assert(
      a.platformAdmin || (m?.active && ["owner", "admin"].includes(m.role)),
      403,
      "需要团队管理权限",
    );
    if (method === "GET")
      return {
        items: await db.creditLedger.findMany({
          where: { teamId: id, kind: "allocation" },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      };
  }
  if (group === "teams" && action === "wallet" && method === "GET") {
    requireHuman(a);
    const m = await db.teamMember.findUnique({
      where: { teamId_userId: { teamId: id, userId: a.userId } },
    });
    assert(a.platformAdmin || m?.active, 403, "无权查看团队钱包");
    return db.wallet.findUniqueOrThrow({ where: { teamId: id } });
  }
  if (group === "teams" && action === "usage" && method === "GET") {
    requireHuman(a);
    const m = await db.teamMember.findUnique({
      where: { teamId_userId: { teamId: id, userId: a.userId } },
    });
    assert(
      a.platformAdmin || (m?.active && ["owner", "admin"].includes(m.role)),
      403,
      "需要团队管理权限",
    );
    return {
      items: await db.usageRecord.findMany({
        where: { teamId: id },
        select: {
          id: true,
          actorId: true,
          model: true,
          kind: true,
          charged: true,
          costType: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    };
  }
  if (
    group !== "platform" ||
    !["users", "dashboard", "settings", "personal-credits"].includes(id)
  )
    return undefined;
  requirePlatform(a);
  if (id === "personal-credits" && method === "POST")
    return adjustPersonal(a, body);
  if (id === "settings") {
    if (method === "GET")
      return db.platformSetting.findUniqueOrThrow({ where: { id: "main" } });
    if (method === "PATCH") {
      const d = z
        .object({ fallbackCny: z.coerce.number().positive().max(1e6) })
        .parse(body);
      return db.$transaction(async (tx) => {
        const result = await tx.platformSetting.update({
          where: { id: "main" },
          data: { ...d, updatedBy: a.userId },
        });
        await tx.auditEvent.create({
          data: {
            teamId: a.teamId,
            actorId: a.userId,
            actorType: "human",
            action: "platform.default_price_changed",
            data: d,
          },
        });
        return result;
      });
    }
  }
  if (id === "users") {
    if (method === "GET" && !action) {
      const page = Math.max(1, Math.floor(Number(params.get("page")) || 1)),
        limit = 20,
        q = (params.get("q") ?? "").slice(0, 100);
      const where = q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { email: { contains: q, mode: "insensitive" as const } },
              { phone: { contains: q } },
            ],
          }
        : {};
      const [total, users] = await Promise.all([
        db.user.count({ where }),
        db.user.findMany({
          where,
          select: userSelect,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
      ]);
      const wallets = await db.userWallet.findMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
      return {
        page,
        limit,
        total,
        items: users.map((u) => ({
          ...u,
          wallet: wallets.find((w) => w.userId === u.id) ?? {
            balance: 0,
            frozen: 0,
          },
        })),
      };
    }
    if (method === "GET" && action) {
      const user = await db.user.findUnique({
        where: { id: action },
        select: userSelect,
      });
      assert(user, 404, "用户不存在");
      const memberships = await db.teamMember.findMany({
        where: { userId: action },
      });
      const teams = await db.team.findMany({
        where: { id: { in: memberships.map((m) => m.teamId) } },
      });
      return {
        ...user,
        wallet: await db.userWallet.findUnique({ where: { userId: action } }),
        teams: memberships.map((m) => ({
          ...m,
          name: teams.find((t) => t.id === m.teamId)?.name,
        })),
        usage: await db.usageRecord.findMany({
          where: { actorId: action },
          select: {
            id: true,
            teamId: true,
            model: true,
            kind: true,
            status: true,
            charged: true,
            costCny: true,
            costType: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        ledger: await db.personalCreditLedger.findMany({
          where: { userId: action },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      };
    }
    if (method === "POST" && !action) {
      const d = z
        .object({
          name: z.string().min(1).max(100),
          email: z.email().transform((v) => v.toLowerCase()),
          password: z.string().min(12).max(200),
          platformAdmin: z.boolean().default(false),
        })
        .parse(body);
      assert(
        !(await db.user.findUnique({ where: { email: d.email } })),
        409,
        "邮箱已存在",
      );
      const passwordHash = await bcrypt.hash(d.password, 12);
      return db.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            name: d.name,
            email: d.email,
            passwordHash,
            platformAdmin: d.platformAdmin,
          },
          select: userSelect,
        });
        await createTeam(tx, u.id, u.name + "的团队", true);
        await tx.auditEvent.create({
          data: {
            teamId: a.teamId,
            actorId: a.userId,
            actorType: "human",
            action: "platform.user_created",
            entityId: u.id,
            data: { name: u.name },
          },
        });
        return u;
      });
    }
    if (
      (method === "PATCH" && action) ||
      (method === "POST" && extra === "reset-password")
    ) {
      const d =
        extra === "reset-password"
          ? z.object({ password: z.string().min(12).max(200) }).parse(body)
          : z
              .object({
                name: z.string().min(1).max(100).optional(),
                active: z.boolean().optional(),
                platformAdmin: z.boolean().optional(),
              })
              .parse(body);
      const hash =
        "password" in d ? await bcrypt.hash(d.password, 12) : undefined;
      return db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform-admin-users'))`;
        const old = await tx.user.findUnique({ where: { id: action } });
        assert(old, 404, "用户不存在");
        if (
          old.platformAdmin &&
          old.active &&
          (("active" in d && d.active === false) ||
            ("platformAdmin" in d && d.platformAdmin === false))
        )
          assert(
            (await tx.user.count({
              where: { platformAdmin: true, active: true, id: { not: action } },
            })) > 0,
            409,
            "不能停用或移除最后一个有效平台管理员",
          );
        const data = hash ? { passwordHash: hash } : d;
        const u = await tx.user.update({
          where: { id: action },
          data,
          select: userSelect,
        });
        if (
          hash ||
          ("active" in d && d.active === false) ||
          ("platformAdmin" in d && d.platformAdmin !== old.platformAdmin)
        )
          await tx.session.deleteMany({ where: { userId: action } });
        if ("active" in d && d.active === false) {
          await tx.agentRun.updateMany({
            where: {
              ownerId: action,
              status: { in: ["queued", "running", "waiting_inputs", "paused"] },
            },
            data: { stopRequested: true, status: "stopped", leaseUntil: null },
          });
          await tx.message.updateMany({
            where: {
              status: "streaming",
              conversationId: {
                in: (
                  await tx.conversation.findMany({
                    where: { ownerId: action },
                    select: { id: true },
                  })
                ).map((c) => c.id),
              },
            },
            data: { status: "stopped" },
          });
        }
        await tx.auditEvent.create({
          data: {
            teamId: a.teamId,
            actorId: a.userId,
            actorType: "human",
            action: hash ? "platform.password_reset" : "platform.user_updated",
            entityId: action,
            data: hash ? { passwordReset: true } : d,
          },
        });
        return u;
      });
    }
  }
  if (id === "dashboard" && method === "GET") {
    const now = new Date(),
      days = Number(params.get("days") ?? 30);
    assert([1, 7, 30].includes(days), 422, "无效日期范围");
    const from = params.get("from")
        ? new Date(params.get("from")!)
        : days === 1
          ? new Date(
              Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate(),
                -8,
              ) +
                Math.floor((now.getUTCHours() + 8) / 24) * 86400000,
            )
          : new Date(now.getTime() - days * 86400000),
      to = params.get("to") ? new Date(params.get("to")!) : now;
    assert(
      Number.isFinite(+from) &&
        Number.isFinite(+to) &&
        to >= from &&
        +to - +from <= 366 * 86400000,
      422,
      "日期范围无效或超过一年",
    );
    const where: any = { createdAt: { gte: from, lte: to } };
    for (const k of ["teamId", "actorId", "channelId", "model"])
      if (params.get(k)) where[k] = params.get(k);
    const [
      users,
      teams,
      active,
      total,
      statuses,
      costs,
      models,
      reconcile,
      channels,
      rates,
    ] = await Promise.all([
      db.user.count(),
      db.team.count({ where: { archived: false } }),
      db.usageRecord.groupBy({ by: ["actorId"], where }),
      db.usageRecord.count({ where }),
      db.usageRecord.groupBy({ by: ["status"], where, _count: { _all: true } }),
      db.usageRecord.groupBy({
        by: ["costType"],
        where,
        _sum: { costCny: true, charged: true },
      }),
      db.usageRecord.groupBy({
        by: ["model", "channelId"],
        where,
        _count: { _all: true },
        _sum: { charged: true },
      }),
      db.usageRecord.count({ where: { ...where, status: "reconcile" } }),
      db.channel.findMany({
        where: { enabled: true },
        select: { id: true, name: true, models: true },
      }),
      db.purchaseRate.findMany({
        where: {
          sourceType: "verified",
          supplier: "",
          effectiveAt: { lte: now },
        },
        select: { channelId: true, model: true, kind: true },
      }),
    ]);
    const missing = channels.flatMap((c) =>
      Object.entries(c.models as Record<string, string[]>).flatMap(
        ([kind, ms]) =>
          ms
            .filter(
              (m) =>
                !rates.some(
                  (r) =>
                    r.channelId === c.id && r.model === m && r.kind === kind,
                ),
            )
            .map((model) => ({
              channelId: c.id,
              channel: c.name,
              kind,
              model,
            })),
      ),
    );
    const successful =
      statuses.find((s) => s.status === "settled")?._count._all ?? 0;
    const failures = await db.usageRecord.count({
      where: {
        ...where,
        OR: [{ error: { not: null } }, { status: "released" }],
      },
    });
    return {
      from,
      to,
      users,
      teams,
      activeUsers: active.length,
      requests: total,
      successRate: total ? successful / total : 0,
      successful,
      failures,
      reconcile,
      costs,
      models,
      statuses,
      missingRates: missing,
    };
  }
  return undefined;
}
