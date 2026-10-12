import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import sharp from "sharp";
import { systemDb as db } from "../src/lib/db";
import { createTeam } from "../src/lib/teams";
import { digest, encrypt } from "../src/lib/security";
const base = process.env.APP_URL!;
assert(
  base === "http://127.0.0.1:3002" &&
    process.env.DATABASE_URL?.endsWith("/frameflow_teams"),
  "Isolated database only",
);
let checked = 0;
async function request(
  auth: string,
  path: string,
  method = "GET",
  body?: any,
  status = 200,
) {
  const form = body instanceof FormData;
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      Origin: base,
      ...(auth.startsWith("Bearer ")
        ? { Authorization: auth }
        : { Cookie: auth }),
      ...(!form ? { "Content-Type": "application/json" } : {}),
      "Idempotency-Key": randomUUID(),
    },
    ...(body !== undefined ? { body: form ? body : JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, status, path + ": " + JSON.stringify(data));
  checked++;
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? auth };
}
async function main() {
  const password = "Account-test-123456",
    email = "account-" + Date.now() + "@example.test";
  const user = await db.user.create({
    data: {
      email,
      name: "账号验收",
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  const team = await db.$transaction((tx) =>
    createTeam(tx, user.id, "账号验收团队", false),
  );
  const login = await request("", "/auth/login", "POST", { email, password }),
    cookie = login.cookie;
  const second = await request("", "/auth/login", "POST", { email, password });
  await request("", "/auth/profile", "GET", undefined, 401);
  assert.equal((await request(cookie, "/auth/profile")).data.phone, null);
  await request(cookie, "/auth/profile", "PATCH", { name: "  更新昵称  " });
  assert.equal((await request(cookie, "/auth/me")).data.name, "更新昵称");
  await request(cookie, "/auth/profile", "PATCH", { name: "  " }, 422);
  const avatar = new FormData();
  avatar.append(
    "file",
    new Blob(
      [
        new Uint8Array(
          await sharp({
            create: {
              width: 40,
              height: 40,
              channels: 3,
              background: "#c5f17b",
            },
          })
            .png()
            .toBuffer(),
        ),
      ],
      { type: "image/png" },
    ),
    "avatar.png",
  );
  const saved = await request(cookie, "/auth/avatar", "POST", avatar);
  assert(saved.data.avatarUrl.startsWith("https://"));
  assert((await request(cookie, "/auth/profile")).data.avatarUrl);
  const tooLarge = new FormData();
  tooLarge.append(
    "file",
    new Blob([new Uint8Array(512 * 1024 + 1)], { type: "image/png" }),
    "large.png",
  );
  await request(cookie, "/auth/avatar", "POST", tooLarge, 422);
  const feedback = new FormData();
  feedback.append("type", "产品建议");
  feedback.append("content", "账号验收：反馈内容与附件应当留存。");
  feedback.append(
    "files",
    new Blob(["isolated feedback attachment"], { type: "text/plain" }),
    "reference.txt",
  );
  const f = await request(cookie, "/feedback", "POST", feedback);
  assert(
    (await request(cookie, "/feedback")).data.some(
      (r: any) => r.id === f.data.id,
    ),
  );
  const links = await request(
    cookie,
    "/feedback/" + f.data.id + "/attachments",
  );
  assert.equal(links.data.length, 1);
  assert.equal((await fetch(links.data[0].url)).status, 200);
  const invalid = new FormData();
  invalid.append("type", "产品建议");
  invalid.append("content", "无效附件数量检查");
  for (let i = 0; i < 4; i++)
    invalid.append(
      "files",
      new Blob(["x"], { type: "text/plain" }),
      i + ".txt",
    );
  await request(cookie, "/feedback", "POST", invalid, 422);
  const peer = await db.user.create({
    data: {
      email: "peer-" + email,
      name: "同队成员",
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  await db.teamMember.create({
    data: { teamId: team.id, userId: peer.id, role: "viewer" },
  });
  const peerLogin = await request("", "/auth/login", "POST", {
    email: peer.email,
    password,
  });
  assert.equal((await request(peerLogin.cookie, "/feedback")).data.length, 0);
  await request(
    peerLogin.cookie,
    "/feedback/" + f.data.id + "/attachments",
    "GET",
    undefined,
    404,
  );
  const other = await db.$transaction((tx) =>
    createTeam(tx, user.id, "账号验收第二团队", false),
  );
  await request(cookie, "/teams/" + other.id + "/switch", "POST", {});
  await request(
    cookie,
    "/feedback/" + f.data.id + "/attachments",
    "GET",
    undefined,
    404,
  );
  await request(cookie, "/teams/" + team.id + "/switch", "POST", {});
  const token = "avp_" + randomUUID();
  await db.apiKey.create({
    data: {
      teamId: team.id,
      name: "账号权限验收",
      prefix: token.slice(0, 12),
      hash: digest(token),
      ciphertext: encrypt(token),
      ownerId: user.id,
      scopes: ["read", "write"],
      productIds: [],
    },
  });
  await request("Bearer " + token, "/auth/profile", "GET", undefined, 403);
  await request("Bearer " + token, "/feedback", "GET", undefined, 403);
  await request(
    cookie,
    "/auth/change-password",
    "POST",
    { currentPassword: "wrong", password: "New-account-123456" },
    422,
  );
  await request(cookie, "/auth/change-password", "POST", {
    currentPassword: password,
    password: "New-account-123456",
  });
  await request(second.cookie, "/auth/me", "GET", undefined, 401);
  await request(cookie, "/auth/me");
  await request("", "/auth/login", "POST", { email, password }, 401);
  await request("", "/auth/login", "POST", {
    email,
    password: "New-account-123456",
  });
  console.log(
    "PASS " +
      checked +
      " account, attachment, feedback isolation and password/session checks",
  );
}
main().finally(() => db.$disconnect());
