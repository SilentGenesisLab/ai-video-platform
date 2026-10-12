import { strict as assert } from "node:assert";
import { randomUUID, createHmac } from "node:crypto";
import { systemDb as db, withTeam, db as scoped } from "../src/lib/db";
import { teamActor, authenticate } from "../src/lib/auth";
import { decrypt, encrypt } from "../src/lib/security";
import { meteredCall } from "../src/lib/metering";
import { rateLine, settleUsage } from "../src/lib/billing";
import { workerActor } from "../src/lib/worker-access";
import { consumeSms } from "../src/lib/sms";
assert(
  process.env.DATABASE_URL?.endsWith("/frameflow_teams") ||
    (process.env.ALLOW_LOCAL_REVIEW_TESTS === "1" &&
      process.env.APP_URL === "http://127.0.0.1:3000" &&
      process.env.DATABASE_URL?.includes("127.0.0.1:55432/aivideo")),
);
async function main() {
  const user = await db.user.findFirstOrThrow({
      where: { name: { startsWith: "隔离甲" } },
      orderBy: { createdAt: "desc" },
    }),
    member = await db.teamMember.findFirstOrThrow({
      where: { userId: user.id, role: "owner" },
      orderBy: { createdAt: "asc" },
    }),
    a = await teamActor(user, member.teamId);
  const key = await db.apiKey.findFirstOrThrow({ where: { teamId: a.teamId } }),
    token = decrypt(key.ciphertext);
  const bearer = new Request(process.env.APP_URL + "/api/v1/auth/me", {
    headers: { authorization: "Bearer " + token },
  });
  assert.equal((await authenticate(bearer)).teamId, a.teamId);
  const other = await db.team.findFirstOrThrow({
    where: { id: { not: a.teamId }, createdBy: user.id },
  });
  await db.session.updateMany({
    where: { userId: user.id },
    data: { teamId: other.id },
  });
  assert.equal((await authenticate(bearer)).teamId, a.teamId);
  const file = await db.fileObject.create({
    data: {
      teamId: a.teamId,
      productId: (
        await db.resource.findFirstOrThrow({
          where: { teamId: a.teamId, kind: "product" },
        })
      ).id,
      key: "aivideo/test-only/" + randomUUID(),
      name: "test.txt",
      mime: "text/plain",
      bytes: 4,
      status: "ready",
      createdBy: user.id,
    },
  });
  await withTeam(other.id, async () => {
    assert.equal(
      await scoped.fileObject.findUnique({ where: { id: file.id } }),
      null,
    );
    assert.equal(
      await scoped.revision.count({ where: { resourceId: file.productId! } }),
      0,
    );
    assert.equal(
      await scoped.apiKey.findUnique({ where: { id: key.id } }),
      null,
    );
    assert.equal(
      await scoped.auditEvent.count({ where: { teamId: a.teamId } }),
      0,
    );
  });
  const channel = await db.channel.create({
    data: {
      name: "Metering test",
      provider: "deepseek",
      baseUrl: "https://example.invalid",
      ciphertext: encrypt("not-real"),
      models: { text: ["mock-text"] },
    },
  });
  const rate = await db.purchaseRate.create({
    data: {
      channelId: channel.id,
      model: "mock-text",
      kind: "text",
      unit: "token",
      rate: 10,
      inputRate: 2,
      cachedInputRate: 1,
      version: 1,
      basis: "test",
      createdBy: user.id,
    },
  });
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "hello" } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
    );
  };
  const input = {
      model: "mock-text",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 200,
    },
    invocationId = "mock:" + randomUUID();
  await withTeam(a.teamId, async () => {
    await meteredCall(a, invocationId, channel.id, "text", "mock-text", input);
    await meteredCall(a, invocationId, channel.id, "text", "mock-text", input);
  });
  assert.equal(calls, 1);
  const usage = await db.usageRecord.findUniqueOrThrow({
    where: { invocationId },
  });
  assert.equal(usage.charged?.toString(), "0.22");
  assert.equal(usage.costType, "calculated");
  await assert.rejects(
    db.personalCreditLedger.update({
      where: { eventKey: "settle:" + usage.id },
      data: { reason: "tamper" },
    }),
  );
  await assert.rejects(
    db.purchaseRate.update({ where: { id: rate.id }, data: { rate: 1 } }),
  );
  global.fetch = async () => {
    calls++;
    throw Error("transport interrupted");
  };
  const uncertain = "unknown:" + randomUUID();
  await withTeam(a.teamId, async () => {
    await assert.rejects(
      meteredCall(a, uncertain, channel.id, "text", "mock-text", input),
    );
    await assert.rejects(
      meteredCall(a, uncertain, channel.id, "text", "mock-text", input),
    );
  });
  assert.equal(calls, 2);
  const unknown = await db.usageRecord.findUniqueOrThrow({
    where: { invocationId: uncertain },
  });
  assert.equal(unknown.status, "reconcile");
  await settleUsage(unknown.id, 100000, "actual");
  assert.equal(
    (await db.usageRecord.findUniqueOrThrow({ where: { id: unknown.id } }))
      .status,
    "reconcile",
  );
  await settleUsage(unknown.id, 0, "manual");
  global.fetch = async () => new Response("rejected", { status: 400 });
  const rejected = "rejected:" + randomUUID();
  await withTeam(a.teamId, async () => {
    await assert.rejects(
      meteredCall(a, rejected, channel.id, "text", "mock-text", input),
    );
    await assert.rejects(
      meteredCall(a, rejected, channel.id, "text", "mock-text", input),
    );
  });
  const rejectedUsage = await db.usageRecord.findUniqueOrThrow({
    where: { invocationId: rejected },
  });
  assert.equal(rejectedUsage.status, "released");
  assert.equal(rejectedUsage.charged?.toString(), "0");
  global.fetch = originalFetch;
  const p = await db.purchaseRate.create({
    data: {
      channelId: channel.id,
      model: "image-params",
      kind: "image",
      unit: "image",
      rate: 1,
      version: 1,
      basis: "test",
      createdBy: user.id,
    },
  });
  await db.purchaseRate.create({
    data: {
      channelId: channel.id,
      model: "image-params",
      kind: "image",
      unit: "image",
      rate: 3,
      version: 2,
      pricingParameters: { quality: "high" },
      basis: "test",
      createdBy: user.id,
    },
  });
  assert.equal(
    (await rateLine(channel.id, "image-params", "image", { quality: "high" }))
      .amount,
    "300",
  );
  assert.equal(
    (await rateLine(channel.id, "image-params", "image", {})).amount,
    "100",
  );
  await db.apiKey.update({ where: { id: key.id }, data: { enabled: false } });
  await assert.rejects(authenticate(bearer));
  await assert.rejects(workerActor(a.teamId, key.id));
  const id = randomUUID(),
    phone = "+86130" + String(Date.now()).slice(-8),
    code = "567890";
  await db.smsChallenge.create({
    data: {
      id,
      phone,
      purpose: "reset",
      hash: createHmac("sha256", process.env.INTERNAL_SERVICE_SECRET!)
        .update(id + ":" + code)
        .digest("hex"),
      ipHash: "test",
      status: "sent",
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  await assert.rejects(consumeSms(phone, "reset", code));
  console.log(
    "PASS: fixed-team keys, cross-team files/revisions/logs, immediate revocation, metered LLM replay protection, unknown cost retention, overdraft prevention, parameter pricing and immutable financial records. Mock transport only.",
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
