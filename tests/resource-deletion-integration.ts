import { strict as assert } from "node:assert";
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
  process.env.DATABASE_URL?.includes("127.0.0.1:55432/frameflow_teams"),
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
      { id: userId, name: "删除验收", passwordHash: "fixture" },
      { id: viewerId, name: "只读验收", passwordHash: "fixture" },
    ],
  });
  await db.team.createMany({
    data: [
      { id: teamId, name: "删除隔离测试", createdBy: userId },
      { id: otherTeam, name: "边界测试", createdBy: userId },
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
    { title: "删除产品", content: {} },
    201,
  );
  const batch = await request(
    human,
    "/creative-batches",
    "POST",
    { title: "批次", productId: product.id, content: {} },
    201,
  );
  const concept = await request(
    human,
    "/concepts",
    "POST",
    {
      title: "创意",
      productId: product.id,
      parentId: batch.id,
      content: { idea: "历史内容" },
    },
    201,
  );
  const plan = await request(
    human,
    "/plans",
    "POST",
    {
      title: "策划",
      productId: product.id,
      parentId: concept.id,
      content: {},
      sources: [{ resourceId: concept.id, version: 1 }],
    },
    201,
  );
  const board = await request(
    human,
    "/storyboards",
    "POST",
    { title: "分镜", productId: product.id, planId: plan.id, content: {} },
    201,
  );
  const asset = await request(
    human,
    "/assets",
    "POST",
    { title: "资产", productId: product.id, planId: plan.id, content: {} },
    201,
  );
  const script = await request(
    human,
    "/scripts",
    "POST",
    { title: "脚本", productId: product.id, planId: plan.id, content: {} },
    201,
  );
  const file = await db.fileObject.create({
    data: {
      teamId,
      productId: product.id,
      name: "fixture.mp4",
      key: "isolated-delete/" + randomUUID(),
      mime: "video/mp4",
      bytes: 1,
      status: "ready",
      createdBy: userId,
    },
  });
  const deliverable = await request(
    human,
    "/deliverables",
    "POST",
    {
      title: "成片",
      productId: product.id,
      planId: plan.id,
      content: { fileId: file.id },
    },
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
  await request(
    human,
    "/products/" + cross.id,
    "DELETE",
    { baseVersion: 1 },
    404,
  );
  await request(
    viewer,
    "/resources/" + concept.id,
    "DELETE",
    { baseVersion: 1 },
    403,
  );
  await request(
    human,
    "/assets/" + concept.id,
    "DELETE",
    { baseVersion: 1 },
    404,
  );
  await request(human, "/resources/" + concept.id, "DELETE", {}, 422);
  await request(
    human,
    "/resources/" + concept.id,
    "DELETE",
    { baseVersion: 9 },
    409,
  );
  await request(
    human,
    "/products/" + product.id,
    "DELETE",
    { baseVersion: 1 },
    400,
    "",
  );
  const limited = await createKey(
    ["product.read", "creative.read", "asset.read", "asset.write"],
    [product.id],
  );
  await request(
    limited.token,
    "/resources/" + concept.id,
    "DELETE",
    { baseVersion: 1 },
    403,
  );
  await request(
    limited.token,
    "/concepts/" + concept.id,
    "DELETE",
    { baseVersion: 1 },
    403,
  );
  const writable = await createKey(
    ["product.read", "creative.read", "creative.write"],
    [product.id],
  );
  const replay = randomUUID();
  const archived = await request(
    writable.token,
    "/resources/" + concept.id,
    "DELETE",
    { baseVersion: 1 },
    200,
    replay,
  );
  assert.equal(archived.version, 2);
  assert.equal(archived.status, "archived");
  assert.equal(
    (
      await request(
        writable.token,
        "/resources/" + concept.id,
        "DELETE",
        { baseVersion: 1 },
        200,
        replay,
      )
    ).version,
    2,
  );
  await request(human, "/api-keys/" + writable.key.id, "PATCH", {
    name: "收紧",
    permissions: ["product.read", "creative.read"],
  });
  await request(
    writable.token,
    "/resources/" + concept.id,
    "DELETE",
    { baseVersion: 1 },
    403,
    replay,
  );
  assert.equal(
    (await request(human, "/plans/" + plan.id)).parentId,
    concept.id,
  );
  assert.equal((await request(human, "/plans/" + plan.id)).status, "draft");
  await request(
    human,
    "/concepts/" + concept.id,
    "DELETE",
    { baseVersion: 1 },
    409,
  );
  const restored = await request(human, "/concepts/" + concept.id, "PATCH", {
    title: concept.title,
    content: concept.content,
    status: "draft",
    baseVersion: 2,
  });
  assert.equal(restored.version, 3);
  for (const [collection, resource] of [
    ["products", product],
    ["creative-batches", batch],
    ["concepts", restored],
    ["plans", plan],
    ["storyboards", board],
    ["assets", asset],
    ["scripts", script],
    ["deliverables", deliverable],
  ] as const) {
    const deleted = await request(
      human,
      "/" + collection + "/" + resource.id,
      "DELETE",
      { baseVersion: resource.version },
    );
    assert.equal(deleted.status, "archived");
    assert.deepEqual(deleted.content, resource.content);
    const detail = await request(human, "/resources/" + resource.id);
    assert.equal(detail.revisions.length, deleted.version);
    assert.deepEqual(detail.revisions[0].sources, detail.revisions[1].sources);
    assert.equal(
      (await request(human, "/" + collection + "?status=archived")).items.some(
        (r: any) => r.id === resource.id,
      ),
      true,
    );
  }
  assert.equal(
    (await db.fileObject.findUniqueOrThrow({ where: { id: file.id } })).status,
    "ready",
  );
  assert.equal(
    await db.auditEvent.count({
      where: { teamId, action: "resource.deleted" },
    }),
    9,
  );
  assert.equal(await db.productionBatch.count({ where: { teamId } }), 0);
  console.log(
    `DELETE: ${checked} API assertions passed across 8 resource types; permissions, replay, version conflict, restore and preserved sources/files verified.`,
  );
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
