import type { User } from "@prisma/client";
import { systemDb as db } from "./db";
import { assert } from "./errors";
import { digest } from "./security";
export type Actor = {
  id: string;
  userId: string;
  name: string;
  type: "human" | "agent";
  role: string;
  scopes: string[];
  productIds: string[];
  teamId: string;
  teamName: string;
  teamRole: string;
  platformAdmin: boolean;
  sessionId?: string;
  keyId?: string;
  runId?: string;
};
export const roles: Record<string, string[]> = {
  admin: ["read", "write", "generate", "approve", "admin"],
  owner: ["read", "write", "generate", "approve", "admin"],
  editor: ["read", "write", "generate"],
  reviewer: ["read", "approve"],
  viewer: ["read"],
};
export const agentScopes = ["read", "write", "generate"];
export async function teamActor(u: User, teamId: string): Promise<Actor> {
  const [member, team] = await Promise.all([
    db.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: u.id } },
    }),
    db.team.findUnique({ where: { id: teamId } }),
  ]);
  assert(
    u.active && member?.active && team && !team.archived,
    403,
    "当前团队已停用或你已不在该团队",
    "TEAM_ACCESS",
  );
  return {
    id: u.id,
    userId: u.id,
    name: u.name,
    type: "human",
    role: member.role === "owner" ? "admin" : member.role,
    teamRole: member.role,
    scopes: roles[member.role] ?? [],
    productIds: [],
    teamId,
    teamName: team.name,
    platformAdmin: u.platformAdmin,
  };
}
export async function authenticate(req: Request): Promise<Actor> {
  const auth = req.headers.get("authorization");
  if (auth) {
    assert(auth.startsWith("Bearer "), 401, "无效的鉴权格式");
    const token = auth.slice(7),
      hash = digest(token);
    if (token.startsWith("avr_")) {
      const run = await db.agentRun.findUnique({ where: { tokenHash: hash } });
      assert(
        run && ["queued", "running"].includes(run.status) && !run.stopRequested,
        401,
        "Agent 运行凭据已失效",
      );
      const u = await db.user.findUnique({ where: { id: run.ownerId } });
      assert(u?.active, 401, "账号已停用");
      const actor = await teamActor(u, run.teamId);
      let scopes = run.scopes,
        productIds = run.productIds;
      if (run.sourceKeyId) {
        const k = await db.apiKey.findUnique({
          where: { id: run.sourceKeyId },
        });
        assert(
          k &&
            k.teamId === run.teamId &&
            k.ownerId === u.id &&
            k.enabled &&
            !k.revokedAt &&
            (!k.expiresAt || k.expiresAt > new Date()),
          401,
          "发起运行的 API Key 已失效",
        );
        scopes = scopes.filter((s) => k.scopes.includes(s));
        if (k.productIds.length) {
          productIds = productIds.length
            ? productIds.filter((id) => k.productIds.includes(id))
            : k.productIds;
          assert(productIds.length, 403, "产品范围已撤销");
        }
      }
      return {
        ...actor,
        id: run.id,
        type: "agent",
        platformAdmin: false,
        scopes: scopes.filter(
          (s) => actor.scopes.includes(s) && agentScopes.includes(s),
        ),
        productIds,
        runId: run.id,
      };
    }
    const k = await db.apiKey.findUnique({
      where: { hash },
      include: { owner: true },
    });
    assert(
      k &&
        k.enabled &&
        !k.revokedAt &&
        (!k.expiresAt || k.expiresAt > new Date()) &&
        k.owner.active,
      401,
      "API Key 无效、过期或已撤销",
    );
    const actor = await teamActor(k.owner, k.teamId);
    await db.apiKey.update({
      where: { id: k.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      ...actor,
      id: k.id,
      type: "agent",
      platformAdmin: false,
      scopes: k.scopes.filter(
        (s) => actor.scopes.includes(s) && agentScopes.includes(s),
      ),
      productIds: k.productIds,
      keyId: k.id,
    };
  }
  const token = req.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("av_session="))
    ?.slice(11);
  assert(token, 401, "请先登录");
  const session = await db.session.findUnique({
    where: { hash: digest(token) },
    include: { user: true },
  });
  assert(
    session && session.expiresAt > new Date() && session.user.active,
    401,
    "登录已过期",
  );
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) sameOrigin(req);
  let teamId = session.teamId;
  if (new URL(req.url).pathname.match(/\/api\/v1\/(auth\/me|teams)(\/|$)/)) {
    const member = await db.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: session.userId } },
      }),
      team = await db.team.findUnique({ where: { id: teamId } });
    if (!member?.active || team?.archived) {
      const memberships = await db.teamMember.findMany({
          where: { userId: session.userId, active: true },
        }),
        available = await db.team.findFirst({
          where: {
            id: { in: memberships.map((m) => m.teamId) },
            archived: false,
          },
        });
      assert(available, 403, "没有可用团队，请联系平台管理员");
      teamId = available.id;
      await db.session.update({ where: { id: session.id }, data: { teamId } });
    }
  }
  return { ...(await teamActor(session.user, teamId)), sessionId: session.id };
}
export function sameOrigin(req: Request) {
  assert(
    req.headers.get("origin") ===
      new URL(process.env.APP_URL ?? "http://localhost:3000").origin,
    403,
    "需要同源请求",
  );
}
export function requireScope(a: Actor, s: string) {
  assert(a.scopes.includes(s), 403, "没有此操作权限", "FORBIDDEN");
}
export function requireHuman(a: Actor) {
  assert(a.type === "human", 403, "此操作仅允许人类登录会话", "HUMAN_REQUIRED");
}
export function requirePlatform(a: Actor) {
  requireHuman(a);
  assert(a.platformAdmin, 403, "仅平台管理员可操作", "PLATFORM_ADMIN_REQUIRED");
}
export function productAccess(a: Actor, id?: string | null) {
  assert(
    !a.productIds.length || (!!id && a.productIds.includes(id)),
    403,
    "无权访问此产品",
    "PRODUCT_SCOPE",
  );
}
export function resourceFilter(a: Actor) {
  return {
    teamId: a.teamId,
    ...(a.productIds.length
      ? {
          OR: [
            { kind: "product", id: { in: a.productIds } },
            { productId: { in: a.productIds } },
          ],
        }
      : {}),
  };
}
