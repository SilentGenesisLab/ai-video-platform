import type { User } from "@prisma/client";
import { db } from "./db";
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
  keyId?: string;
  runId?: string;
};
export const roles: Record<string, string[]> = {
  admin: ["read", "write", "generate", "approve", "admin"],
  editor: ["read", "write", "generate"],
  reviewer: ["read", "approve"],
  viewer: ["read"],
};
export const agentScopes = ["read", "write", "generate"];
function human(u: User): Actor {
  return {
    id: u.id,
    userId: u.id,
    name: u.name,
    type: "human",
    role: u.role,
    scopes: roles[u.role] ?? [],
    productIds: [],
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
      const user = await db.user.findUnique({ where: { id: run.ownerId } });
      assert(user?.active, 401, "账号已停用");
      let scopes = run.scopes,
        productIds = run.productIds;
      if (run.sourceKeyId) {
        const source = await db.apiKey.findUnique({
          where: { id: run.sourceKeyId },
        });
        assert(
          source &&
            source.enabled &&
            !source.revokedAt &&
            (!source.expiresAt || source.expiresAt > new Date()),
          401,
          "发起运行的 API Key 已失效",
        );
        scopes = scopes.filter((s) => source.scopes.includes(s));
        if (source.productIds.length) {
          productIds = productIds.length
            ? productIds.filter((id) => source.productIds.includes(id))
            : source.productIds;
          assert(productIds.length, 403, "运行的产品范围已撤销");
        }
      }
      return {
        ...human(user),
        id: run.id,
        type: "agent",
        scopes: scopes.filter(
          (s) =>
            (roles[user.role] ?? []).includes(s) && agentScopes.includes(s),
        ),
        productIds,
        runId: run.id,
      };
    }
    const key = await db.apiKey.findUnique({
      where: { hash },
      include: { owner: true },
    });
    assert(
      key &&
        key.enabled &&
        !key.revokedAt &&
        (!key.expiresAt || key.expiresAt > new Date()) &&
        key.owner.active,
      401,
      "API Key 无效、过期或已撤销",
    );
    await db.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      ...human(key.owner),
      id: key.id,
      type: "agent",
      scopes: key.scopes.filter(
        (s) =>
          (roles[key.owner.role] ?? []).includes(s) && agentScopes.includes(s),
      ),
      productIds: key.productIds,
      keyId: key.id,
    };
  }
  const sessionToken = req.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("av_session="))
    ?.slice(11);
  assert(sessionToken, 401, "请先登录");
  const session = await db.session.findUnique({
    where: { hash: digest(sessionToken) },
    include: { user: true },
  });
  assert(
    session && session.expiresAt > new Date() && session.user.active,
    401,
    "登录已过期",
  );
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    assert(
      origin === new URL(process.env.APP_URL ?? "http://localhost:3000").origin,
      403,
      "需要同源登录会话",
    );
  }
  return human(session.user);
}
export function requireScope(actor: Actor, scope: string) {
  assert(actor.scopes.includes(scope), 403, "没有此操作权限", "FORBIDDEN");
}
export function requireHuman(actor: Actor) {
  assert(
    actor.type === "human",
    403,
    "此操作仅允许人类登录会话",
    "HUMAN_REQUIRED",
  );
}
export function productAccess(actor: Actor, productId?: string | null) {
  assert(
    !actor.productIds.length ||
      (!!productId && actor.productIds.includes(productId)),
    403,
    "无权访问此产品",
    "PRODUCT_SCOPE",
  );
}
export function resourceFilter(actor: Actor) {
  return actor.productIds.length
    ? {
        OR: [
          { kind: "product", id: { in: actor.productIds } },
          { productId: { in: actor.productIds } },
        ],
      }
    : {};
}
