import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { GET as handle } from "../src/app/api/v1/[...path]/route";
import { systemDb as db } from "../src/lib/db";
import { digest, decrypt, encrypt, randomToken } from "../src/lib/security";
import {
  legacyPermissions,
  recommendedPermissions,
} from "../src/lib/permissions";
assert(
  process.env.DATABASE_URL?.includes("127.0.0.1:55432/frameflow_compact"),
  "Only isolated test database permitted",
);
const base = process.env.APP_URL!,
  teamId = randomUUID(),
  otherTeam = randomUUID(),
  userId = randomUUID(),
  viewerId = randomUUID(),
  session = randomToken(),
  viewerSession = randomToken();
let checked = 0;
async function request(
  credential: string,
  path: string,
  method = "GET",
  body?: any,
  expected = 200,
  replay?: string,
) {
  const req = new NextRequest(base + "/api/v1" + path, {
    method,
    headers: {
      ...(credential.startsWith("av_session=")
        ? { Cookie: credential }
        : { Authorization: "Bearer " + credential }),
      Origin: base,
      "Content-Type": "application/json",
      "Idempotency-Key": replay ?? randomUUID(),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await handle(req, {
    params: Promise.resolve({
      path: path.split("?")[0].split("/").filter(Boolean),
    }),
  });
  const data = await result.json();
  assert.equal(result.status, expected, path + ": " + JSON.stringify(data));
  checked++;
  return data;
}
const human = "av_session=" + session,
  viewer = "av_session=" + viewerSession;
async function createKey(permissions: string[], ids: string[] = []) {
  const key = await request(
    human,
    "/api-keys",
    "POST",
    {
      name: "授权验收",
      permissions,
      productScopeMode: ids.length ? "selected" : "all",
      productIds: ids,
    },
    201,
  );
  const stored = await db.apiKey.findUniqueOrThrow({ where: { id: key.id } });
  return { key, token: decrypt(stored.ciphertext) };
}
async function main() {
  await db.user.createMany({
    data: [
      { id: userId, name: "权限验收", passwordHash: "fixture", active: true },
      { id: viewerId, name: "只读验收", passwordHash: "fixture", active: true },
    ],
  });
  await db.team.createMany({
    data: [
      { id: teamId, name: "权限测试团队", createdBy: userId },
      { id: otherTeam, name: "边界团队", createdBy: userId },
    ],
  });
  await db.teamMember.createMany({
    data: [
      { teamId, userId, role: "owner" },
      { teamId, userId: viewerId, role: "viewer" },
    ],
  });
  await db.session.createMany({
    data: [
      {
        teamId,
        userId,
        hash: digest(session),
        expiresAt: new Date(Date.now() + 3600000),
      },
      {
        teamId,
        userId: viewerId,
        hash: digest(viewerSession),
        expiresAt: new Date(Date.now() + 3600000),
      },
    ],
  });
  const product = await request(
    human,
    "/products",
    "POST",
    { title: "权限产品", content: {} },
    201,
  );
  const second = await request(
    human,
    "/products",
    "POST",
    { title: "其他产品", content: {} },
    201,
  );
  const cross = await db.resource.create({
    data: {
      teamId: otherTeam,
      kind: "product",
      title: "跨团队",
      content: {},
      createdBy: userId,
      updatedBy: userId,
    },
  });
  const asset = await db.resource.create({
    data: {
      teamId,
      kind: "asset",
      productId: product.id,
      title: "资产",
      content: {},
      createdBy: userId,
      updatedBy: userId,
    },
  });
  const file = await db.fileObject.create({
    data: {
      teamId,
      productId: product.id,
      name: "file.txt",
      key: "isolated-keys/" + randomUUID(),
      mime: "text/plain",
      bytes: 1,
      status: "ready",
      extractedText: "secret file content",
      createdBy: userId,
    },
  });
  const read = await createKey(["product.read"], [product.id]);
  const me = await request(read.token, "/auth/me");
  assert.deepEqual(me.permissions, ["product.read"]);
  assert.equal(me.productScopeMode, "selected");
  assert.equal((await request(read.token, "/products")).total, 1);
  await request(read.token, `/products/${second.id}`, "GET", undefined, 403);
  await request(read.token, `/products/${cross.id}`, "GET", undefined, 404);
  await request(read.token, `/resources/${asset.id}`, "GET", undefined, 403);
  await request(read.token, "/assets", "GET", undefined, 403);
  await request(read.token, "/channels", "GET", undefined, 403);
  await request(read.token, `/files/${file.id}`, "GET", undefined, 403);
  await request(read.token, "/billing/wallet", "GET", undefined, 403);
  await request(read.token, "/api-keys/options", "GET", undefined, 403);
  await request(read.token, "/api-keys", "POST", { name: "forbidden" }, 403);
  await request(
    human,
    `/api-keys/${read.key.id}`,
    "PATCH",
    { name: "old range expansion", productIds: [product.id, second.id] },
    409,
  );
  const context = await request(read.token, `/products/${product.id}/context`);
  assert.equal(context.resources.length, 0);
  assert.equal(context.files.length, 0);
  await request(
    human,
    "/api-keys",
    "POST",
    { name: "missing dependency", permissions: ["asset.generate"] },
    422,
  );
  await request(
    human,
    "/api-keys",
    "POST",
    {
      name: "empty selected",
      permissions: ["product.read"],
      productScopeMode: "selected",
      productIds: [],
    },
    422,
  );
  await request(
    human,
    "/api-keys",
    "POST",
    {
      name: "invalid all",
      permissions: ["product.read"],
      productScopeMode: "all",
      productIds: [product.id],
    },
    422,
  );
  await request(
    human,
    "/api-keys",
    "POST",
    { name: "admin fake", permissions: ["admin.approve"] },
    422,
  );
  await request(
    human,
    `/api-keys/${read.key.id}`,
    "PATCH",
    { name: "old client", scopes: ["read", "write"] },
    409,
  );
  await request(
    human,
    `/api-keys/${read.key.id}`,
    "PATCH",
    { name: "old range", productIds: [] },
    409,
  );
  await request(human, `/api-keys/${read.key.id}`, "PATCH", {
    name: "metadata only",
  });
  assert.deepEqual((await request(read.token, "/auth/me")).permissions, [
    "product.read",
  ]);
  const options = await request(human, "/api-keys/options?ownerId=" + viewerId);
  assert(
    options.grantable.every(
      (p: string) => !/write|generate|execute|control|analyze/.test(p),
    ),
  );
  await request(
    human,
    "/api-keys",
    "POST",
    {
      name: "viewer overgrant",
      ownerId: viewerId,
      permissions: ["product.read", "product.write"],
    },
    403,
  );
  await request(
    viewer,
    "/api-keys",
    "POST",
    { name: "overgrant", permissions: ["product.read", "product.write"] },
    403,
  );
  const all = await createKey(["product.read", "product.write"]);
  const replay = randomUUID();
  const future = await request(
    all.token,
    "/products",
    "POST",
    { title: "未来产品", content: {} },
    201,
    replay,
  );
  await request(all.token, `/products/${future.id}`);
  await request(human, `/api-keys/${all.key.id}`, "PATCH", {
    name: "收紧",
    permissions: ["product.read"],
    productScopeMode: "all",
    productIds: [],
  });
  await request(
    all.token,
    "/products",
    "POST",
    { title: "未来产品", content: {} },
    403,
    replay,
  );
  const chat = await createKey([
    "product.read",
    "asset.read",
    "chat.read",
    "chat.execute",
    "chat.control",
  ]);
  const c = await request(
    chat.token,
    "/conversations",
    "POST",
    { title: "运行测试", productId: product.id },
    201,
  );
  const runToken = randomToken("avr_");
  const run = await db.agentRun.create({
    data: {
      teamId,
      conversationId: c.id,
      ownerId: userId,
      sourceKeyId: chat.key.id,
      status: "running",
      prompt: "fixture",
      tokenHash: digest(runToken),
      tokenCiphertext: encrypt(runToken),
      scopes: ["read", "write", "generate"],
      permissions: chat.key.permissions,
      productScopeMode: "selected",
      productIds: [product.id],
    },
  });
  await request(runToken, `/resources/${asset.id}`);
  await request(human, `/api-keys/${chat.key.id}`, "PATCH", {
    name: "运行收紧",
    permissions: ["product.read", "chat.read", "chat.execute", "chat.control"],
    productScopeMode: "all",
    productIds: [],
  });
  await request(runToken, `/resources/${asset.id}`, "GET", undefined, 403);
  await request(human, `/api-keys/${chat.key.id}`, "PATCH", {
    name: "禁用",
    permissions: ["product.read"],
    enabled: false,
  });
  await request(runToken, "/auth/me", "GET", undefined, 401);
  await db.agentRun.update({
    where: { id: run.id },
    data: { status: "paused", stopRequested: true },
  });
  const legacyToken = randomToken();
  await db.apiKey.create({
    data: {
      teamId,
      ownerId: userId,
      name: "旧Key",
      prefix: legacyToken.slice(0, 12),
      hash: digest(legacyToken),
      ciphertext: encrypt(legacyToken),
      scopes: ["read"],
      productIds: [],
    },
  });
  assert.deepEqual(
    (await request(legacyToken, "/auth/me")).permissions,
    legacyPermissions(["read"]),
  );
  await request(
    legacyToken,
    "/products",
    "POST",
    { title: "no", content: {} },
    403,
  );
  const downgraded = await createKey(["product.read", "product.write"]);
  await db.teamMember.update({
    where: { teamId_userId: { teamId, userId } },
    data: { role: "viewer" },
  });
  await request(
    downgraded.token,
    `/products/${product.id}`,
    "PATCH",
    { title: "no", content: {}, baseVersion: 1 },
    403,
  );
  await db.teamMember.update({
    where: { teamId_userId: { teamId, userId } },
    data: { role: "owner" },
  });
  const rotated = await createKey(["product.read"]);
  await request(human, `/api-keys/${rotated.key.id}/rotate`, "POST", {});
  await request(rotated.token, "/auth/me", "GET", undefined, 401);
  const revoked = await createKey(["product.read"]);
  await request(human, `/api-keys/${revoked.key.id}`, "DELETE");
  await request(revoked.token, "/auth/me", "GET", undefined, 401);
  const expired = await createKey(["product.read"]);
  await db.apiKey.update({
    where: { id: expired.key.id },
    data: { expiresAt: new Date(Date.now() - 1) },
  });
  await request(expired.token, "/auth/me", "GET", undefined, 401);
  const video = await createKey([
    "product.read",
    "video.read",
    "video.generate",
  ]);
  const channel = await db.channel.create({
    data: {
      name: "免费验收，无请求",
      provider: "aicentre",
      baseUrl: "https://unused.invalid",
      ciphertext: encrypt("fixture"),
      models: { image: ["gpt-image-2.5"], video: ["seedance-2.5"] },
    },
  });
  await db.purchaseRate.create({
    data: {
      channelId: channel.id,
      model: "seedance-2.5",
      kind: "video",
      version: 1,
      unit: "second",
      rate: 2,
      resolution: "720p",
      basis: "fixture",
      createdBy: userId,
    },
  });
  const batch = {
    title: "仅待审批",
    kind: "video",
    productId: product.id,
    entries: [
      {
        channelId: channel.id,
        model: "seedance-2.5",
        prompt: "测试，禁止审批",
        parameters: { duration_seconds: 5, resolution: "720p" },
      },
    ],
  };
  const quote = await request(video.token, "/billing/quotes", "POST", batch);
  const pending = await request(
    video.token,
    "/production-batches",
    "POST",
    { ...batch, quoteId: quote.id },
    201,
  );
  assert.equal(pending.status, "pending_approval");
  assert.equal(await db.job.count({ where: { batchId: pending.id } }), 0);
  await request(
    video.token,
    `/approvals/${pending.id}`,
    "POST",
    { approved: true },
    403,
  );
  await request(read.token, "/billing/quotes", "POST", batch, 403);
  await request(
    video.token,
    "/billing/quotes",
    "POST",
    {
      ...batch,
      kind: "image",
      entries: [{ ...batch.entries[0], model: "gpt-image-2.5" }],
    },
    403,
  );
  await db.productionBatch.update({
    where: { id: pending.id },
    data: { status: "rejected" },
  });
  const jobs = await db.job.createManyAndReturn({
    data: [
      {
        teamId,
        productId: product.id,
        kind: "image",
        input: {},
        status: "failed",
      },
      {
        teamId,
        productId: product.id,
        kind: "video",
        input: {},
        status: "failed",
      },
    ],
  });
  assert.equal((await request(video.token, "/jobs")).items.length, 1);
  await request(
    video.token,
    `/jobs/${jobs.find((j) => j.kind === "image")!.id}`,
    "GET",
    undefined,
    403,
  );
  assert.equal(
    (await request(video.token, "/production-batches")).items.length,
    1,
  );
  const copies = await request(
    human,
    `/api-keys/${video.key.id}/connection-instructions`,
    "POST",
    {},
  );
  assert.deepEqual(copies.permissions, video.key.permissions);
  assert.equal(copies.skillVersion, JSON.parse(readFileSync("package.json", "utf8")).version);
  assert(
    !JSON.stringify(await request(human, "/api-keys")).includes(video.token),
  );
  await db.resource.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      teamId,
      kind: "product",
      title: `分页授权 ${String(i).padStart(3, "0")}`,
      content: {},
      createdBy: userId,
      updatedBy: userId,
    })),
  });
  assert.equal(
    (
      await request(
        human,
        "/products?limit=100&page=2&q=" + encodeURIComponent("分页授权"),
      )
    ).items.length,
    25,
  );
  assert(!recommendedPermissions.includes("operations.billing"));
  console.log(
    `KEY PERMISSIONS: ${checked} API assertions passed; no paid generation submitted.`,
  );
  await db.channel.update({
    where: { id: channel.id },
    data: { enabled: false },
  });
}
main()
  .finally(async () => {
    await db.apiKey.updateMany({
      where: { teamId },
      data: { enabled: false, revokedAt: new Date(), ciphertext: "" },
    });
    await db.resource.updateMany({
      where: { teamId },
      data: { status: "archived" },
    });
    await db.team.updateMany({
      where: { id: { in: [teamId, otherTeam] } },
      data: { archived: true },
    });
    await db.session.deleteMany({ where: { teamId } });
    await db.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
