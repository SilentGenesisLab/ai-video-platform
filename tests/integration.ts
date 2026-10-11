import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { digest, encrypt, randomToken } from "../src/lib/security";
const base = process.env.APP_URL ?? "http://localhost:3000";
let cookie = "";
let checks = 0;
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
  key = randomUUID(),
) {
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      "Idempotency-Key": key,
      ...(token ? { Authorization: "Bearer " + token } : { Cookie: cookie }),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  return { status: r.status, data, headers: r.headers };
}
function check(value: unknown, message: string) {
  assert(value, message);
  checks++;
  console.log("PASS " + message);
}
async function main() {
  const login = await request("/auth/login", "POST", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  check(login.status === 200, "human login");
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const p = await request("/products", "POST", {
    title: "集成验收 · 便携咖啡机",
    content: {
      description: "测试产品；无营销承诺",
      sellingPoints: ["便携设计"],
      audience: "通勤用户",
      brief: "用于接口与权限验证",
    },
  });
  check(p.status === 201, "create product");
  const product = p.data;
  const other = await request("/products", "POST", {
    title: "集成验收 · 隔离产品",
    content: {},
  });
  check(other.status === 201, "create second product");
  const sameKey = randomUUID();
  const [one, two] = await Promise.all([
    request(
      "/creative-batches",
      "POST",
      { title: "验收创意批次", productId: product.id, content: {} },
      undefined,
      sameKey,
    ),
    request(
      "/creative-batches",
      "POST",
      { title: "验收创意批次", productId: product.id, content: {} },
      undefined,
      sameKey,
    ),
  ]);
  check(
    one.data.id === two.data.id && one.status === 201 && two.status === 201,
    "concurrent creates share one idempotent result",
  );
  const collision = await request(
    "/creative-batches",
    "POST",
    { title: "不同输入", productId: product.id, content: {} },
    undefined,
    sameKey,
  );
  check(collision.status === 409, "idempotency body mismatch rejected");
  const updated = await request("/products/" + product.id, "PATCH", {
    title: product.title,
    baseVersion: 1,
    content: { ...product.content, brief: "人工更新 Brief" },
  });
  check(
    updated.status === 200 && updated.data.version === 2,
    "revision increments",
  );
  const stale = await request("/products/" + product.id, "PATCH", {
    title: product.title,
    baseVersion: 1,
    content: product.content,
  });
  check(stale.status === 409, "stale Agent update rejected");
  const key = await request("/api-keys", "POST", {
    name: "集成验收 Agent",
    productIds: [product.id],
    scopes: ["read", "write", "generate"],
  });
  check(
    key.status === 201 && !JSON.stringify(key.data).includes("ciphertext"),
    "key creation does not reveal credential",
  );
  const instruction = await request(
    "/api-keys/" + key.data.id + "/connection-instructions",
    "POST",
    {},
  );
  const token = /AIVIDEO_API_KEY=(\S+)/.exec(
    instruction.data.instructions,
  )?.[1];
  assert(token);
  check(
    instruction.status === 200 &&
      instruction.headers.get("cache-control") === "no-store",
    "human-only connection instructions are not cached",
  );
  check(
    (await request("/auth/me", "GET", undefined, token)).data.type === "agent",
    "key identity is Agent",
  );
  check(
    (await request("/products/" + other.data.id, "GET", undefined, token))
      .status === 403,
    "cross-product detail blocked",
  );
  check(
    (
      await request(
        "/production-batches?productId=" + other.data.id,
        "GET",
        undefined,
        token,
      )
    ).status === 403,
    "cross-product batch query blocked",
  );
  check(
    (
      await request(
        "/concepts?productId=" + other.data.id,
        "GET",
        undefined,
        token,
      )
    ).status === 403,
    "filtered resource list cannot bypass product scope",
  );
  const scoped = await request("/products", "GET", undefined, token);
  check(
    scoped.data.items.length === 1 && scoped.data.items[0].id === product.id,
    "collection respects product scope",
  );
  check(
    (await request("/products", "POST", { title: "越权", content: {} }, token))
      .status === 403,
    "scoped key cannot create unscoped products",
  );
  check(
    (await request("/api-keys", "GET", undefined, token)).status === 403,
    "Agent cannot list platform keys",
  );
  check(
    (
      await request(
        "/api-keys/" + key.data.id + "/connection-instructions",
        "POST",
        {},
        token,
      )
    ).status === 403,
    "Agent cannot copy connection secrets",
  );
  const concept = await request(
    "/concepts",
    "POST",
    {
      title: "清晨一杯",
      productId: product.id,
      parentId: one.data.id,
      content: { hook: "早晨也可以从容", idea: "把通勤间隙变成咖啡时刻" },
    },
    token,
  );
  check(concept.status === 201, "Agent creates concept");
  const plan = await request(
    "/plans",
    "POST",
    {
      title: "清晨一杯 · 策划案",
      productId: product.id,
      parentId: concept.data.id,
      content: {},
    },
    token,
  );
  check(plan.status === 201, "Agent creates treatment");
  const board = await request(
    "/storyboards",
    "POST",
    {
      title: "工业分镜",
      productId: product.id,
      planId: plan.data.id,
      content: {
        shots: [
          { id: "shot-1", number: 1, duration: 5, description: "桌上咖啡机" },
        ],
      },
    },
    token,
  );
  check(board.status === 201, "industrial storyboard belongs to treatment");
  check(
    (
      await request(
        "/storyboards",
        "POST",
        {
          title: "重复分镜",
          productId: product.id,
          planId: plan.data.id,
          content: { shots: [] },
        },
        token,
      )
    ).status === 409,
    "one storyboard per plan enforced",
  );
  const channel = (await request("/channels")).data.items.find(
    (c: any) => c.provider === "aicentre",
  );
  assert(channel);
  check(
    !JSON.stringify(channel).includes("ciphertext"),
    "channel discovery has no provider secrets",
  );
  const batch = await request(
    "/production-batches",
    "POST",
    {
      title: "待人工审批 · 集成测试",
      productId: product.id,
      planId: plan.data.id,
      kind: "video",
      entries: [
        {
          channelId: channel.id,
          model: "seedance-2.5",
          prompt: "静止的咖啡机产品镜头",
          parameters: { duration_seconds: 5, resolution: "720p" },
        },
      ],
    },
    token,
  );
  check(
    batch.status === 201 && batch.data.status === "pending_approval",
    "video submission waits for human approval",
  );
  check(
    (await db.job.count({ where: { batchId: batch.data.id } })) === 0,
    "no paid job before approval",
  );
  check(
    (
      await request(
        "/approvals/" + batch.data.id,
        "POST",
        { digest: batch.data.digest, decision: "approve" },
        token,
      )
    ).status === 403,
    "Agent cannot self-approve",
  );
  check(
    (
      await request("/approvals/" + batch.data.id, "POST", {
        digest: "wrong",
        decision: "approve",
      })
    ).status === 409,
    "approval snapshot mismatch rejected",
  );
  check(
    (
      await request("/approvals/" + batch.data.id, "POST", {
        digest: batch.data.digest,
        decision: "reject",
      })
    ).status === 200,
    "human rejection works without provider call",
  );
  await request("/api-keys/" + key.data.id + "/rotate", "POST", {});
  check(
    (await request("/auth/me", "GET", undefined, token)).status === 401,
    "rotation invalidates old key immediately",
  );
  const newInstruction = await request(
      "/api-keys/" + key.data.id + "/connection-instructions",
      "POST",
      {},
    ),
    newToken = /AIVIDEO_API_KEY=(\S+)/.exec(
      newInstruction.data.instructions,
    )![1];
  await request("/api-keys/" + key.data.id, "PATCH", {
    name: "只读 Agent",
    scopes: ["read"],
    productIds: [product.id],
  });
  check(
    (
      await request(
        "/concepts",
        "POST",
        { title: "越权", productId: product.id, content: {} },
        newToken,
      )
    ).status === 403,
    "permission reduction takes effect immediately",
  );
  await request("/api-keys/" + key.data.id, "PATCH", {
    name: "禁用测试",
    scopes: ["read"],
    productIds: [product.id],
    enabled: false,
  });
  check(
    (await request("/auth/me", "GET", undefined, newToken)).status === 401,
    "disabled key immediately rejected",
  );
  const conversation = await db.conversation.create({
    data: {
      title: "凭据继承测试",
      ownerId: key.data.ownerId,
      productId: product.id,
    },
  });
  const runToken = randomToken("avr_");
  const run = await db.agentRun.create({
    data: {
      conversationId: conversation.id,
      ownerId: key.data.ownerId,
      sourceKeyId: key.data.id,
      prompt: "Do not execute",
      tokenHash: digest(runToken),
      tokenCiphertext: encrypt(runToken),
      scopes: ["read", "write"],
      productIds: [product.id],
      status: "running",
      leaseUntil: new Date(Date.now() + 600000),
    },
  });
  check(
    (await request("/auth/me", "GET", undefined, runToken)).status === 401,
    "disabling origin key also invalidates its delegated Agent run",
  );
  await db.agentRun.update({
    where: { id: run.id },
    data: { status: "stopped", stopRequested: true },
  });
  check(
    (
      await request(
        "/api-keys/" + key.data.id + "/connection-instructions",
        "POST",
        {},
      )
    ).status === 409,
    "disabled key cannot produce instructions",
  );
  await request("/api-keys/" + key.data.id, "PATCH", {
    name: "到期测试",
    scopes: ["read"],
    productIds: [product.id],
    enabled: true,
    expiresAt: "2020-01-01T00:00:00.000Z",
  });
  check(
    (await request("/auth/me", "GET", undefined, newToken)).status === 401,
    "expired key rejected",
  );
  await request("/api-keys/" + key.data.id, "DELETE");
  check(
    (await request("/auth/me", "GET", undefined, newToken)).status === 401,
    "revocation invalidates key immediately",
  );
  const spec = await request("/openapi.json");
  check(
    spec.status === 200 && !!spec.data.paths["/api/v1/storyboards"],
    "OpenAPI publishes storyboard contract",
  );
  const audit = await request("/audit-events");
  check(
    !JSON.stringify(audit.data).includes(token) &&
      !JSON.stringify(audit.data).includes(newToken),
    "audit does not leak keys",
  );
  const skill = await fetch(base + "/skills/ai-video-platform/SKILL.md");
  check(
    skill.ok && !(await skill.text()).includes(token),
    "public Skill is credential-free",
  );
  let immutable = false;
  try {
    await db.revision.updateMany({
      where: { resourceId: product.id, version: 1 },
      data: { title: "bad" },
    });
  } catch {
    immutable = true;
  }
  check(immutable, "database rejects historical revision mutation");
  console.log(
    `Integration acceptance: ${checks} checks passed; no paid generation triggered.`,
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
