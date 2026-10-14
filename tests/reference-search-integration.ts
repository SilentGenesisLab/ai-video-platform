import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { referenceSearchRoute } from "../src/lib/reference-search";
import { GET as handle } from "../src/app/api/v1/[...path]/route";
import { systemDb as db } from "../src/lib/db";
import { digest, decrypt, encrypt, randomToken } from "../src/lib/security";
import {
  legacyPermissions,
  recommendedPermissions,
} from "../src/lib/permissions";
assert(
  process.env.DATABASE_URL?.includes("127.0.0.1:55432/frameflow_teams") ||
    process.env.DATABASE_URL?.endsWith("/frameflow_reference_test"),
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
  const result = path.includes("reference-searches")
    ? await referenceSearchRoute(req, {
        params: Promise.resolve({
          productId: path.split("/")[2],
          jobId: path.split("/")[4],
        }),
      })
    : await handle(req, {
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
  process.env.VIDEODATA_API_KEY = "test-private-key";
  process.env.OSS_ACCESS_KEY_ID = "fixture";
  process.env.OSS_ACCESS_KEY_SECRET = "fixture";
  const file = await db.fileObject.create({
    data: {
      teamId,
      productId: product.id,
      name: "image.png",
      key: "fixture.png",
      mime: "image/png",
      bytes: 100,
      status: "ready",
      createdBy: userId,
    },
  });
  let submissions = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url: any, options: any) => {
    assert.equal(options.headers["X-API-Key"], "test-private-key");
    if (String(url).endsWith("/searches")) {
      submissions++;
      return Response.json({ task_id: "fixture-task", status: "queued" });
    }
    if (String(url).includes("/tasks/"))
      return Response.json({
        status: "succeeded",
        percent: 100,
        run_id: "fixture-run",
      });
    return Response.json({
      dimensions: [
        {
          key: "category",
          name: "同品类",
          videos: [
            {
              title: "参考",
              url: "https://example.com/video",
              score: 9,
              reference: "参考点",
            },
          ],
        },
      ],
    });
  };
  try {
    const path = "/products/" + product.id + "/reference-searches",
      key = randomUUID();
    const job = await request(
      human,
      path,
      "POST",
      { imageFileId: file.id, brief: "TVC测试" },
      202,
      key,
    );
    assert.equal(job.status, "searching");
    await request(
      human,
      path,
      "POST",
      { imageFileId: file.id, brief: "TVC测试" },
      202,
      key,
    );
    assert.equal(submissions, 1);
    const completed = await request(human, path + "/" + job.id);
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.result.run.dimensions[0].videos.length, 1);
    assert.equal((await request(human, path)).items.length, 1);
    await request(viewer, path, "POST", { imageFileId: file.id }, 403);
    const limited = await createKey(["product.read"], [product.id]);
    await request(limited.token, path, "GET", undefined, 403);
    await request(human, path + "/" + randomUUID(), "GET", undefined, 404);
    await request(human, path, "POST", { imageFileId: randomUUID() }, 404);
    await request(
      human,
      path,
      "POST",
      { imageFileId: file.id, automatic: true },
      202,
    );
    await request(
      human,
      path,
      "POST",
      { imageFileId: file.id, automatic: true },
      202,
    );
    assert.equal(submissions, 1);
    console.log(
      `REFERENCE SEARCH: ${checked} API assertions; async results, replay, product ownership and permissions passed; no real inference.`,
    );
  } finally {
    globalThis.fetch = original;
  }
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
