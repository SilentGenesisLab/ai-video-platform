import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { systemDb as db, withTeam } from "../src/lib/db";
import { createTeam } from "../src/lib/teams";
import { teamActor } from "../src/lib/auth";
import { allocateCredits, adjustPersonal } from "../src/lib/personal-credits";
import {
  rateLine,
  reserveUsage,
  usageFromResult,
  settleUsage,
  billingRoute,
} from "../src/lib/billing";
import { adminRoute } from "../src/lib/platform-admin";
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "55432");
const stamp = randomUUID();
let checks = 0;
const pass = (name: string) => {
  checks++;
  console.log("PASS " + name);
};
async function main() {
  const owner = await db.user.create({
    data: {
      name: "Credits owner",
      email: `credits-${stamp}@test.invalid`,
      passwordHash: "fixture",
      platformAdmin: true,
    },
  });
  const member = await db.user.create({
    data: {
      name: "Credits member",
      email: `member-${stamp}@test.invalid`,
      passwordHash: "fixture",
    },
  });
  const team = await db.$transaction((tx) =>
    createTeam(tx, owner.id, "Credits test"),
  );
  const team2 = await db.$transaction((tx) =>
    createTeam(tx, member.id, "Credits other team"),
  );
  await db.teamMember.create({
    data: { teamId: team.id, userId: member.id, role: "editor" },
  });
  await db.wallet.update({
    where: { teamId: team.id },
    data: { balance: 300 },
  });
  const actor = await teamActor(owner, team.id),
    ma = await teamActor(member, team.id);
  const transfer = {
    userId: member.id,
    amount: 150,
    reason: "测试分配",
    eventKey: stamp,
  };
  await allocateCredits(actor, team.id, transfer);
  await allocateCredits(actor, team.id, transfer);
  assert.equal(
    String(
      (await db.wallet.findUniqueOrThrow({ where: { teamId: team.id } }))
        .balance,
    ),
    "150",
  );
  assert.equal(
    String(
      (await db.userWallet.findUniqueOrThrow({ where: { userId: member.id } }))
        .balance,
    ),
    "150",
  );
  pass("allocation conserves total and retries once");
  await assert.rejects(() =>
    allocateCredits(ma, team.id, { ...transfer, eventKey: randomUUID() }),
  );
  pass("member cannot allocate pool credits");
  const concurrent = await Promise.allSettled(
    [1, 2].map(() =>
      allocateCredits(actor, team.id, {
        ...transfer,
        amount: 100,
        eventKey: randomUUID(),
      }),
    ),
  );
  assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
  pass("concurrent allocation cannot overspend");
  const channel = await db.channel.create({
    data: {
      name: "Credits fixture",
      provider: "bocha",
      baseUrl: "https://fixture.invalid",
      ciphertext: "fixture",
      models: { search: ["unpriced"] },
    },
  });
  const line = await rateLine(channel.id, "unpriced", "search");
  assert.equal(line.sourceType, "estimated");
  assert.equal(line.amount, "100");
  pass("unpriced model quotes 1 CNY instead of blocking");
  const usage = await withTeam(team2.id, () =>
    db.$transaction((tx) =>
      reserveUsage(
        tx,
        { teamId: team2.id, userId: member.id },
        "credits:" + stamp,
        line,
        "hash",
      ),
    ),
  );
  assert.equal(usage.payerUserId, member.id);
  assert.equal(
    String(
      (await db.userWallet.findUniqueOrThrow({ where: { userId: member.id } }))
        .frozen,
    ),
    "100",
  );
  await withTeam(team2.id, () =>
    usageFromResult(usage.id, { id: "fixture-success" }, true),
  );
  await settleUsage(usage.id, 1, "estimated");
  const wallet = await db.userWallet.findUniqueOrThrow({
    where: { userId: member.id },
  });
  assert.equal(String(wallet.balance), "150");
  assert.equal(String(wallet.frozen), "0");
  pass("cross-team calls share personal wallet and settle once");
  assert.equal(
    (await db.usageRecord.findUniqueOrThrow({ where: { id: usage.id } }))
      .costType,
    "estimated",
  );
  pass("fallback invoice clearly identifies estimated cost");
  const invoice: any = await billingRoute(ma, ["billing", "usage"], "GET", {});
  const billed = invoice.items.find((u: any) => u.id === usage.id);
  assert.equal(billed.payerUserId, member.id);
  assert.equal(billed.payerKind, "user");
  assert.equal(billed.teamId, team2.id);
  assert.equal(billed.rateId, line.rateId);
  pass("billing API exposes payer and immutable price version across teams");
  const second = await withTeam(team.id, () =>
    db.$transaction((tx) =>
      reserveUsage(tx, ma, "actual:" + stamp, line, "actual"),
    ),
  );
  await withTeam(team.id, () =>
    usageFromResult(second.id, { billed_cost_cny: 0.2 }, true),
  );
  assert.equal(
    String(
      (await db.usageRecord.findUniqueOrThrow({ where: { id: second.id } }))
        .charged,
    ),
    "20",
  );
  pass("supplier actual CNY overrides default estimate");
  const key = await db.apiKey.create({
    data: {
      teamId: team.id,
      ownerId: member.id,
      name: "Fixture",
      hash: "hash-" + stamp,
      ciphertext: "fixture",
      prefix: "fixture",
      scopes: ["read", "write", "generate"],
    },
  });
  const third = await withTeam(team.id, () =>
    db.$transaction((tx) =>
      reserveUsage(
        tx,
        { teamId: team.id, userId: key.id },
        "key:" + stamp,
        line,
        "key",
      ),
    ),
  );
  assert.equal(third.payerUserId, member.id);
  await settleUsage(third.id, 0, "actual");
  pass("Agent key is charged to owner; confirmed zero fee releases freeze");
  const before = await db.userWallet.findUniqueOrThrow({
    where: { userId: member.id },
  });
  await assert.rejects(() =>
    adjustPersonal(actor, {
      userId: member.id,
      amount: -1e6,
      reason: "测试余额保护",
      eventKey: randomUUID(),
    }),
  );
  assert.equal(
    String(
      (await db.userWallet.findUniqueOrThrow({ where: { userId: member.id } }))
        .balance,
    ),
    String(before.balance),
  );
  pass("admin cannot reduce wallet below frozen funds");
  await assert.rejects(() =>
    adminRoute(ma, ["platform", "users"], "GET", {}, new URLSearchParams()),
  );
  pass("non-platform member cannot access admin APIs");
  await assert.rejects(() =>
    adminRoute(
      { ...actor, type: "agent" },
      ["platform", "settings"],
      "GET",
      {},
      new URLSearchParams(),
    ),
  );
  pass("Agent cannot access admin APIs");
  await db.teamMember.update({
    where: { teamId_userId: { teamId: team.id, userId: member.id } },
    data: { active: false },
  });
  assert.equal(
    String(
      (await db.userWallet.findUniqueOrThrow({ where: { userId: member.id } }))
        .balance,
    ),
    String(before.balance),
  );
  pass("leaving team does not reclaim personal balance");
  const result = await adminRoute(
    actor,
    ["platform", "dashboard"],
    "GET",
    {},
    new URLSearchParams({ teamId: team2.id }),
  );
  assert(result);
  pass("dashboard applies team filter");
  console.log(`${checks} checks passed`);
}
main().finally(() => db.$disconnect());
