import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { oss } from "../src/lib/storage";
const base = process.env.APP_URL!;
let cookie = "",
  checks = 0;
async function req(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
) {
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      "Idempotency-Key": randomUUID(),
      ...(token ? { Authorization: "Bearer " + token } : { Cookie: cookie }),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
function check(condition: unknown, text: string) {
  assert(condition, text);
  checks++;
  console.log("PASS " + text);
}
async function main() {
  const login = await req("/auth/login", "POST", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const me = (await req("/auth/me")).data;
  const p = (
    await req("/products", "POST", {
      title: "集成验收 · 产品洞察 " + Date.now(),
      content: {
        sellingPoints: ["节省空间"],
        audience: "学校\n园区",
        brief: "# 已有 Brief",
      },
    })
  ).data;
  check(
    p.content.audienceSegments.length === 2,
    "legacy input becomes structured without losing Brief",
  );
  const rev1 = await db.revision.findFirstOrThrow({
    where: { resourceId: p.id, version: 1 },
  });
  let r = await req(`/products/${p.id}`, "PATCH", {
    title: p.title,
    baseVersion: p.version,
    content: {
      sellingPointItems: [
        {
          id: "selling-stable",
          title: "节省空间",
          benefit: "增加车位",
          evidence: "实测",
        },
      ],
    },
  });
  check(
    r.status === 200 && r.data.content.brief === "# 已有 Brief",
    "partial patch preserves omitted content",
  );
  let current = r.data;
  r = await req(`/products/${p.id}`, "PATCH", {
    title: p.title,
    baseVersion: current.version,
    content: { sellingPoints: ["覆盖旧卖点"] },
  });
  check(
    r.status === 409 && r.data.error.code === "PRODUCT_STRUCTURE_CONFLICT",
    "legacy overwrite cannot discard evidence",
  );
  r = await req(`/products/${p.id}`, "PATCH", {
    title: p.title,
    baseVersion: 1,
    content: { description: "过期编辑" },
  });
  check(r.status === 409, "stale human or agent edit is rejected");
  const legacyId = randomUUID();
  await db.resource.create({
    data: {
      id: legacyId,
      kind: "product",
      title: "集成验收 · 未迁移旧产品",
      content: {
        sellingPoints: ["旧卖点"],
        audience: "已有用户",
        fileIds: [],
        facts: [],
      },
      createdBy: me.userId,
      updatedBy: me.userId,
    },
  });
  const legacyBefore = (
    await db.resource.findUniqueOrThrow({ where: { id: legacyId } })
  ).content;
  r = await req(`/products/${legacyId}`);
  check(
    r.status === 200 &&
      r.data.content.sellingPointItems.length === 1 &&
      JSON.stringify(
        (await db.resource.findUniqueOrThrow({ where: { id: legacyId } }))
          .content,
      ) === JSON.stringify(legacyBefore),
    "legacy GET adapter does not rewrite stored content",
  );
  await db.fileObject.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      id: randomUUID(),
      productId: p.id,
      name: `pagination-${i}.txt`,
      key: `testing/no-object/${randomUUID()}`,
      mime: "text/plain",
      bytes: 1,
      status: "ready",
      parseStatus: "skipped",
      createdBy: me.userId,
    })),
  });
  const first = (await req(`/files?productId=${p.id}&limit=100`)).data;
  const second = (await req(`/files?productId=${p.id}&page=2&limit=100`)).data;
  check(
    first.items.length === 100 &&
      second.items.length === 5 &&
      new Set([...first.items, ...second.items].map((f) => f.id)).size === 105,
    "file pagination retrieves all 105 files without overlap",
  );
  const ctx = (await req(`/products/${p.id}/context`)).data;
  const nextCtx = await fetch(base + ctx.pagination.files.next, {
    headers: { Cookie: cookie },
  }).then((r) => r.json());
  check(
    ctx.files.length === 100 &&
      nextCtx.files.length === 5 &&
      ctx.pagination.files.total === 105,
    "context exposes continuation links",
  );
  r = await req(`/products/${p.id}`, "PATCH", {
    title: p.title,
    baseVersion: current.version,
    content: {
      referenceVideos: [
        {
          id: "ref",
          title: "危险链接",
          type: "link",
          url: "javascript:alert(1)",
        },
      ],
    },
  });
  check(r.status === 422, "unsafe external URL rejected");
  const foreign = await db.fileObject.create({
    data: {
      productId: legacyId,
      name: "foreign.mp4",
      key: `testing/no-object/${randomUUID()}`,
      mime: "video/mp4",
      bytes: 1,
      status: "ready",
      parseStatus: "skipped",
      createdBy: me.userId,
    },
  });
  r = await req(`/products/${p.id}`, "PATCH", {
    title: p.title,
    baseVersion: current.version,
    content: {
      referenceVideos: [
        { id: "ref", title: "跨产品", type: "file", fileId: foreign.id },
      ],
    },
  });
  check(r.status === 422, "cross-product file reference rejected");
  r = await req(`/products/${p.id}`, "PATCH", {
    title: p.title,
    baseVersion: current.version,
    content: {
      referenceVideos: [
        {
          id: "ref",
          title: "错误类型",
          type: "file",
          fileId: first.items[0].id,
        },
      ],
    },
  });
  check(r.status === 422, "non-video file reference rejected");
  // A tiny valid MP4 fixture is generated locally, uploaded to OSS, never sent to a model.
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile("tests/fixtures/reference.mp4");
  const before = await db.job.count();
  const init = await req("/files", "POST", {
    productId: p.id,
    name: "参考视频验收.mp4",
    mime: "video/mp4",
    bytes: bytes.length,
    parsePolicy: "skip",
  });
  check(init.status === 201, "skip-analysis upload initialized");
  const put = await fetch(init.data.uploadUrl, {
    method: "PUT",
    headers: init.data.headers,
    body: bytes,
  });
  assert(put.ok);
  const done = await req(`/files/${init.data.file.id}/complete`, "POST", {});
  const doneAgain = await req(
    `/files/${init.data.file.id}/complete`,
    "POST",
    {},
  );
  check(
    done.status === 200 &&
      done.data.parseStatus === "skipped" &&
      doneAgain.status === 200 &&
      (await db.job.count()) === before,
    "reference upload completion is idempotent and creates zero parse jobs",
  );
  const fid = done.data.id;
  r = await req(`/products/${p.id}`, "PATCH", {
    title: p.title,
    baseVersion: current.version,
    content: {
      materials: [
        {
          id: "m1",
          fileId: first.items[0].id,
          category: "document",
          title: "说明书",
          note: "人工整理",
        },
      ],
      referenceVideos: [
        {
          id: "ref-stable",
          title: "参考视频",
          type: "file",
          fileId: fid,
          hook: "先展示问题",
          avoid: "不要照搬卖点",
        },
      ],
    },
  });
  check(
    r.status === 200 &&
      r.data.content.fileIds.length === 1 &&
      r.data.content.referenceVideos[0].hook === "先展示问题",
    "materials and manual video notes are versioned separately",
  );
  current = r.data;
  r = await req(`/products/${p.id}`, "PATCH", {
    title: p.title,
    baseVersion: current.version,
    content: { materials: [] },
  });
  check(
    r.status === 200 &&
      r.data.content.referenceVideos.length === 1 &&
      (await db.fileObject.count({ where: { id: first.items[0].id } })) === 1,
    "unlinking retains file and other product fields",
  );
  const historic = await db.revision.findUniqueOrThrow({
    where: { resourceId_version: { resourceId: p.id, version: 1 } },
  });
  check(
    JSON.stringify(historic.content) === JSON.stringify(rev1.content),
    "historical input remains immutable",
  );
  const key = (
    await req("/api-keys", "POST", {
      name: "洞察只读权限验收",
      scopes: ["read"],
      productIds: [p.id],
    })
  ).data;
  try {
    const instruction = (
      await req(`/api-keys/${key.id}/connection-instructions`, "POST", {})
    ).data;
    const token = /AIVIDEO_API_KEY=(\S+)/.exec(instruction.instructions)![1];
    check(
      (await req(`/products/${legacyId}`, "GET", undefined, token)).status ===
        403,
      "scoped agent cannot read another product",
    );
    check(
      (
        await req(
          `/products/${p.id}`,
          "PATCH",
          {
            title: p.title,
            baseVersion: r.data.version,
            content: { brief: "越权" },
          },
          token,
        )
      ).status === 403,
      "read-only agent cannot update product",
    );
  } finally {
    await req(`/api-keys/${key.id}`, "DELETE");
  }
  console.log(`Product insights integration: ${checks} checks passed.`);
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
