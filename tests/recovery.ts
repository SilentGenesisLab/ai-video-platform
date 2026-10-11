import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { reserveSubmission, providerResult } from "../src/worker/lifecycle";
import { refreshBatch, decideBatch } from "../src/lib/production";
import { canonical, digest, encrypt } from "../src/lib/security";
import type { Actor } from "../src/lib/auth";
async function main() {
  const user = await db.user.findFirstOrThrow({ where: { role: "admin" } });
  const actor: Actor = {
    id: user.id,
    userId: user.id,
    name: user.name,
    type: "human",
    role: "admin",
    scopes: ["read", "write", "generate", "approve", "admin"],
    productIds: [],
  };
  const product = await db.resource.findFirstOrThrow({
    where: { kind: "product" },
  });
  const channel = await db.channel.create({
    data: {
      name: "恢复测试（无外部调用）",
      provider: "aicentre",
      baseUrl: "https://invalid.example",
      ciphertext: encrypt("test-only"),
      enabled: true,
      concurrency: 1,
      models: { image: ["test"] },
    },
  });
  const jobs = await Promise.all(
    [1, 2].map(() =>
      db.job.create({
        data: {
          kind: "image",
          productId: product.id,
          channelId: channel.id,
          input: {},
          leaseUntil: new Date(Date.now() + 600000),
        },
      }),
    ),
  );
  try {
    const reserved = await Promise.all(
      jobs.map((j) =>
        reserveSubmission(j.id, channel.id, channel.baseUrl, "/test"),
      ),
    );
    assert.equal(reserved.filter(Boolean).length, 1);
    console.log(
      "PASS database lock enforces channel concurrency across workers",
    );
    await db.channel.update({
      where: { id: channel.id },
      data: { enabled: false },
    });
    await db.job.updateMany({
      where: { id: { in: jobs.map((j) => j.id) } },
      data: { status: "cancelled", leaseUntil: null },
    });
    const snapshot = {
      entries: [
        {
          channelId: channel.id,
          channelSnapshot: { baseUrl: channel.baseUrl },
          model: "test",
          prompt: "Never submitted",
          parameters: {},
          references: [],
          sources: [],
        },
      ],
    };
    const batch = await db.productionBatch.create({
      data: {
        title: "并发审批恢复测试",
        productId: product.id,
        kind: "video",
        snapshot,
        digest: digest(canonical(snapshot)),
        status: "pending_approval",
        createdBy: user.id,
      },
    });
    const decisions = await Promise.allSettled(
      [1, 2].map(() =>
        decideBatch(actor, batch.id, {
          digest: batch.digest,
          decision: "approve",
        }),
      ),
    );
    assert.equal(decisions.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await db.job.count({ where: { batchId: batch.id } }), 1);
    console.log("PASS concurrent approvals enqueue exactly one job");
    await db.job.updateMany({
      where: { batchId: batch.id },
      data: { status: "succeeded" },
    });
    await db.job.create({
      data: {
        kind: "video",
        productId: product.id,
        batchId: batch.id,
        status: "failed",
        input: {},
      },
    });
    await refreshBatch(batch.id);
    assert.equal(
      (await db.productionBatch.findUniqueOrThrow({ where: { id: batch.id } }))
        .status,
      "partial_success",
    );
    console.log("PASS mixed batch results preserve partial success");
    const missing = randomUUID();
    try {
      await db.$transaction(async (tx) => {
        await tx.outbox.create({ data: { jobId: missing, phase: "submit" } });
        throw new Error("simulated crash before commit");
      });
    } catch {}
    assert.equal(await db.outbox.count({ where: { jobId: missing } }), 0);
    console.log("PASS rolled-back transaction cannot publish a job");
    const signed =
      "https://oss-imgai.sligenai.cn/example?Signature=keep&Expires=123";
    const clean = providerResult({
      status: "succeeded",
      result_urls: [signed],
      request: { authorization: "must-not-store" },
    }) as any;
    assert.equal(clean.result_urls[0], signed);
    assert.equal(clean.request, undefined);
    assert.equal(clean.cost.type, "unknown");
    console.log(
      "PASS signed result URLs survive internal storage; request credentials omitted",
    );
  } finally {
    await db.channel.update({
      where: { id: channel.id },
      data: { enabled: false },
    });
    await db.job.updateMany({
      where: {
        channelId: channel.id,
        status: { in: ["queued", "submitting"] },
      },
      data: { status: "cancelled", leaseUntil: null },
    });
  }
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
