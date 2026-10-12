import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { systemDb as db } from "./db";
import { authenticate, sameOrigin, teamActor, requireHuman } from "./auth";
import { assert } from "./errors";
import { digest, randomToken } from "./security";
import { consumeSms, phoneNumber, sendSms } from "./sms";
import { createTeam } from "./teams";
async function session(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const memberships = await db.teamMember.findMany({
    where: { userId, active: true },
    orderBy: { createdAt: "asc" },
  });
  const teams = await db.team.findMany({
    where: { id: { in: memberships.map((m) => m.teamId) }, archived: false },
  });
  const teamId = memberships.find((m) =>
    teams.some((t) => t.id === m.teamId),
  )?.teamId;
  assert(user.active && teamId, 403, "账号或团队不可用");
  const token = randomToken("session_");
  await db.session.create({
    data: {
      userId,
      teamId,
      hash: digest(token),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
  });
  const r = NextResponse.json(await teamActor(user, teamId), {
    headers: { "Cache-Control": "no-store" },
  });
  r.cookies.set("av_session", token, {
    httpOnly: true,
    secure: (process.env.APP_URL ?? "").startsWith("https:"),
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 86400,
  });
  return r;
}
export async function accountRoute(req: NextRequest, id: string, body: any) {
  if (
    req.method !== "POST" ||
    ![
      "login",
      "sms",
      "register",
      "otp-login",
      "reset-password",
      "bind-phone",
    ].includes(id)
  )
    return null;
  sameOrigin(req);
  if (id === "sms") {
    const actor = body.purpose === "bind" ? await authenticate(req) : null;
    if (actor) requireHuman(actor);
    // Nginx overwrites this header; the app port is bound to loopback in production.
    return NextResponse.json(
      await sendSms(
        body,
        req.headers.get("x-real-ip") ?? "local",
        actor?.userId,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (id === "login") {
    const identifier = z
      .string()
      .min(1)
      .max(200)
      .parse(body.identifier ?? body.email ?? body.phone)
      .trim();
    const password = z.string().max(200).parse(body.password);
    const where = identifier.includes("@")
      ? { email: identifier.toLowerCase() }
      : { phone: phoneNumber(identifier) };
    const target = digest(JSON.stringify(where));
    assert(
      (await db.auditEvent.count({
        where: {
          action: "auth.failed",
          entityId: target,
          createdAt: { gte: new Date(Date.now() - 900000) },
        },
      })) < 10,
      429,
      "登录尝试过多，请稍后重试",
    );
    const user = await db.user.findUnique({ where });
    const matches = await bcrypt.compare(
      password,
      user?.passwordHash ??
        "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
    );
    if (!user?.active || !matches) {
      await db.auditEvent.create({
        data: {
          actorId: "anonymous",
          actorType: "human",
          action: "auth.failed",
          entityId: target,
          data: {},
        },
      });
      assert(false, 401, "账号或密码错误");
    }
    return session(user.id);
  }
  const phone = phoneNumber(body.phone);
  if (id === "bind-phone") {
    const actor = await authenticate(req);
    requireHuman(actor);
    await consumeSms(phone, "bind", body.code, actor.userId);
    const old = await db.user.findUniqueOrThrow({
      where: { id: actor.userId },
    });
    assert(
      !old.phone || old.phone === phone,
      409,
      "已绑定手机号，不能在此更换",
    );
    assert(
      !(await db.user.findFirst({
        where: { phone, id: { not: actor.userId } },
      })),
      409,
      "手机号不可绑定",
    );
    await db.user.update({ where: { id: actor.userId }, data: { phone } });
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (id === "register") {
    const name = z.string().trim().min(1).max(60).parse(body.name),
      password = z
        .string()
        .min(12, "密码至少 12 位")
        .max(72)
        .parse(body.password);
    await consumeSms(phone, "register", body.code);
    assert(
      !(await db.user.findUnique({ where: { phone } })),
      409,
      "该手机号已注册，请登录",
    );
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { phone, name, passwordHash, role: "editor" },
      });
      await createTeam(tx, u.id, name + "的团队", true);
      return u;
    });
    return session(user.id);
  }
  await consumeSms(
    phone,
    id === "reset-password" ? "reset" : "login",
    body.code,
  );
  const user = await db.user.findUnique({ where: { phone } });
  assert(user?.active, 401, "手机号未注册或账号不可用");
  if (id === "reset-password") {
    const passwordHash = await bcrypt.hash(
      z.string().min(12, "密码至少 12 位").max(72).parse(body.password),
      12,
    );
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { userId: user.id } });
    });
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  return session(user.id);
}
