import { strict as assert } from "node:assert";
import { randomUUID, createHmac } from "node:crypto";
import { systemDb as db, withTeam, db as scoped } from "../src/lib/db";
import { encrypt } from "../src/lib/security";
import { sendSms, consumeSms } from "../src/lib/sms";
import { reserveUsage, settleUsage } from "../src/lib/billing";
const base = process.env.APP_URL!;
assert(
  (base === "http://127.0.0.1:3002" &&
    process.env.DATABASE_URL?.endsWith("/frameflow_teams")) ||
    (process.env.ALLOW_LOCAL_REVIEW_TESTS === "1" &&
      base === "http://127.0.0.1:3000" &&
      process.env.DATABASE_URL?.includes("127.0.0.1:55432/aivideo")),
  "Only isolated test database permitted",
);
let checked = 0;
async function request(
  cookie: string,
  path: string,
  method = "GET",
  body?: any,
  expected = 200,
) {
  const r = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, expected, path + ": " + JSON.stringify(data));
  checked++;
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? cookie };
}
async function otp(phone: string, purpose: string) {
  const id = randomUUID(),
    code = "345678";
  await db.smsChallenge.create({
    data: {
      id,
      phone: "+86" + phone,
      purpose,
      hash: createHmac("sha256", process.env.INTERNAL_SERVICE_SECRET!)
        .update(id + ":" + code)
        .digest("hex"),
      ipHash: "isolated-fixture",
      status: "sent",
      expiresAt: new Date(Date.now() + 300000),
    },
  });
  return code;
}
async function main() {
  const suffix = String(Date.now()).slice(-8),
    p1 = "139" + suffix,
    p2 = "138" + suffix;
  const a = await request("", "/auth/register", "POST", {
      phone: p1,
      code: await otp(p1, "register"),
      name: "隔离甲 " + suffix,
      password: "test-password-123",
    }),
    b = await request("", "/auth/register", "POST", {
      phone: p2,
      code: await otp(p2, "register"),
      name: "隔离乙 " + suffix,
      password: "test-password-456",
    });
  assert.notEqual(a.data.teamId, b.data.teamId);
  assert.equal(a.data.platformAdmin, false);
  assert.equal(
    (await request(a.cookie, "/billing/wallet")).data.balance,
    "1000",
  );
  await request(
    "",
    "/auth/register",
    "POST",
    { phone: p1, code: "345678", name: "重放", password: "test-password-123" },
    401,
  );
  await request("", "/auth/login", "POST", {
    phone: p1,
    password: "test-password-123",
  });
  const unknown = "137" + suffix;
  await request(
    "",
    "/auth/otp-login",
    "POST",
    { phone: unknown, code: await otp(unknown, "login") },
    401,
  );
  const second = (
    await request(a.cookie, "/teams", "POST", { name: "额外团队" })
  ).data;
  assert.equal(
    (
      await db.wallet.findUniqueOrThrow({ where: { teamId: second.id } })
    ).balance.toString(),
    "0",
  );
  const product = (
    await request(
      a.cookie,
      "/products",
      "POST",
      { title: "A 产品", content: { description: "测试" } },
      201,
    )
  ).data;
  await request(b.cookie, "/resources/" + product.id, "GET", undefined, 404);
  const list = (await request(b.cookie, "/products")).data;
  assert(!list.items.some((x: any) => x.id === product.id));
  await request(
    b.cookie,
    "/assets",
    "POST",
    { title: "跨团队资产", productId: product.id, content: {} },
    404,
  );
  await request(
    b.cookie,
    "/products/" + product.id + "/revisions",
    "GET",
    undefined,
    404,
  );
  await request(b.cookie, "/channels", "POST", { name: "非法渠道" }, 403);
  await request(a.cookie, "/platform/rates", "GET", undefined, 403);
  const key = (
    await request(
      a.cookie,
      "/api-keys",
      "POST",
      { name: "团队固定 Key", scopes: ["read", "write", "generate"] },
      201,
    )
  ).data;
  const instructions = (
    await request(
      a.cookie,
      `/api-keys/${key.id}/connection-instructions`,
      "POST",
      {},
    )
  ).data;
  assert(JSON.stringify(instructions).includes(a.data.teamId));
  const channel = await db.channel.create({
    data: {
      name: "测试采购渠道 " + suffix,
      provider: "aicentre",
      baseUrl: "https://example.invalid",
      ciphertext: encrypt("test-only"),
      models: { image: ["test-image"], video: ["seedance-2.5"] },
    },
  });
  const input = {
    title: "测试图片批次",
    productId: product.id,
    kind: "image",
    entries: [{ channelId: channel.id, model: "test-image", prompt: "test" }],
  };
  await request(a.cookie, "/billing/quotes", "POST", input, 422);
  const rate = await db.purchaseRate.create({
    data: {
      channelId: channel.id,
      model: "test-image",
      kind: "image",
      unit: "image",
      rate: 2,
      version: 1,
      basis: "本地测试采购",
      createdBy: a.data.userId,
    },
  });
  const q = (await request(a.cookie, "/billing/quotes", "POST", input)).data;
  assert.equal(q.amount, "200");
  await request(
    b.cookie,
    "/production-batches",
    "POST",
    { ...input, quoteId: q.id },
    404,
  );
  const batch = (
    await request(
      a.cookie,
      "/production-batches",
      "POST",
      { ...input, quoteId: q.id },
      201,
    )
  ).data;
  assert.equal((await request(a.cookie, "/billing/wallet")).data.frozen, "200");
  const job = await db.job.findFirstOrThrow({ where: { batchId: batch.id } });
  assert.equal(job.teamId, a.data.teamId);
  await request(b.cookie, "/jobs/" + job.id, "GET", undefined, 404);
  await request(
    a.cookie,
    "/production-batches",
    "POST",
    { ...input, quoteId: q.id },
    409,
  );
  const use = await db.usageRecord.findUniqueOrThrow({
    where: { invocationId: "job:" + job.id },
  });
  await settleUsage(use.id, 1.5);
  await settleUsage(use.id, 1.5);
  const wallet = await db.wallet.findUniqueOrThrow({
    where: { teamId: a.data.teamId },
  });
  assert.equal(wallet.balance.toString(), "850");
  assert.equal(wallet.frozen.toString(), "0");
  const line = {
    rateId: rate.id,
    channelId: channel.id,
    model: "test-image",
    kind: "image",
    amount: "600",
  };
  const race = await withTeam(a.data.teamId, () =>
    Promise.allSettled(
      [1, 2].map((i) =>
        scoped.$transaction((tx) =>
          reserveUsage(
            tx,
            { teamId: a.data.teamId, userId: a.data.userId },
            "race:" + suffix + ":" + i,
            line,
            "same",
          ),
        ),
      ),
    ),
  );
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  const reserved: any = (race.find((r) => r.status === "fulfilled") as any)
    .value;
  await settleUsage(reserved.id, null);
  assert.equal(
    (await db.usageRecord.findUniqueOrThrow({ where: { id: reserved.id } }))
      .status,
    "reconcile",
  );
  await settleUsage(reserved.id, 0, "manual");
  const videoRate = await db.purchaseRate.create({
    data: {
      channelId: channel.id,
      model: "seedance-2.5",
      kind: "video",
      unit: "second",
      rate: 1,
      resolution: "720p",
      version: 1,
      basis: "local",
      createdBy: a.data.userId,
    },
  });
  const vi = {
    ...input,
    kind: "video",
    entries: [
      {
        channelId: channel.id,
        model: "seedance-2.5",
        prompt: "video",
        parameters: { duration_seconds: 5, resolution: "720p" },
      },
    ],
  };
  const vq = (await request(a.cookie, "/billing/quotes", "POST", vi)).data,
    vb = (
      await request(
        a.cookie,
        "/production-batches",
        "POST",
        { ...vi, quoteId: vq.id },
        201,
      )
    ).data;
  assert.equal(
    (
      await db.wallet.findUniqueOrThrow({ where: { teamId: a.data.teamId } })
    ).frozen.toString(),
    "0",
  );
  await db.purchaseRate.create({
    data: {
      channelId: channel.id,
      model: "seedance-2.5",
      kind: "video",
      unit: "second",
      rate: 2,
      resolution: "720p",
      version: 2,
      basis: "new price",
      createdBy: a.data.userId,
    },
  });
  await request(
    a.cookie,
    `/approvals/${vb.id}`,
    "POST",
    { digest: vb.digest, decision: "approve" },
    409,
  );
  const invite = (
    await request(a.cookie, `/teams/${a.data.teamId}/invitations`, "POST", {
      phone: p2,
    })
  ).data;
  const token = invite.url.split("/").pop();
  await request(a.cookie, "/invitations/" + token, "POST", {}, 403);
  await request(b.cookie, "/invitations/" + token, "POST", {});
  await request(b.cookie, "/invitations/" + token, "POST", {}, 410);
  const m = await db.teamMember.findUniqueOrThrow({
    where: { teamId_userId: { teamId: a.data.teamId, userId: b.data.userId } },
  });
  await request(b.cookie, `/teams/${a.data.teamId}/switch`, "POST", {});
  await request(b.cookie, "/resources/" + product.id);
  await request(a.cookie, `/teams/${a.data.teamId}/members/${m.id}`, "PATCH", {
    active: false,
  });
  await request(b.cookie, "/resources/" + product.id, "GET", undefined, 403);
  await request(a.cookie, "/auth/reset-password", "POST", {
    phone: p1,
    code: await otp(p1, "reset"),
    password: "new-password-123",
  });
  await request(a.cookie, "/auth/me", "GET", undefined, 401);
  await request("", "/auth/login", "POST", {
    phone: p1,
    password: "new-password-123",
  });
  // Provider transport is mocked only in this isolated test process; production has no test code.
  for (const name of [
    "SMS_ACCESS_KEY_ID",
    "SMS_ACCESS_KEY_SECRET",
    "SMS_SIGN_NAME",
    "SMS_TEMPLATE_CODE",
  ])
    process.env[name] = "mock-only";
  const originalFetch = global.fetch;
  let delivered = "";
  global.fetch = async (_url: any, init: any) => {
    const fields = new URLSearchParams(init.body);
    delivered = JSON.parse(fields.get("TemplateParam")!).code;
    return new Response(JSON.stringify({ Code: "OK" }), { status: 200 });
  };
  const ph = "136" + suffix;
  await sendSms({ phone: ph, purpose: "login" }, "test-ip-" + suffix);
  await assert.rejects(
    sendSms({ phone: ph, purpose: "login" }, "test-ip-" + suffix),
  );
  await consumeSms("+86" + ph, "login", delivered);
  await assert.rejects(consumeSms("+86" + ph, "login", delivered));
  const ph2 = "135" + suffix;
  await sendSms({ phone: ph2, purpose: "login" }, "test-ip-" + suffix);
  for (let i = 0; i < 5; i++)
    await assert.rejects(consumeSms("+86" + ph2, "login", "000000"));
  await assert.rejects(consumeSms("+86" + ph2, "login", delivered));
  global.fetch = async () =>
    new Response(JSON.stringify({ Code: "FAIL" }), { status: 500 });
  await assert.rejects(
    sendSms(
      { phone: "134" + suffix, purpose: "register" },
      "test-ip-" + suffix,
    ),
  );
  global.fetch = originalFetch;
  console.log(
    `PASS: ${checked} HTTP checks; tenancy, grants, quotes, price changes, concurrent reservations, immutable settlement, invitations, revocation, password reset and OTP lifecycle. No paid provider calls.`,
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
