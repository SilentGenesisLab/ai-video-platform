import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { db, withTeam } from "../src/lib/db";
import { encrypt } from "../src/lib/security";
import { saveRate } from "../src/lib/billing";
import { meteredOperation } from "../src/lib/metering";
import { meteredStream } from "../src/lib/metered-stream";
import { teamActor } from "../src/lib/auth";
import { conversationAccess, fileAccess } from "../src/lib/access";
import { appendEvent } from "../src/lib/events";

async function main() {
  const database = new URL(process.env.DATABASE_URL!);
  assert(
    ["localhost", "127.0.0.1"].includes(database.hostname),
    "Local test database only",
  );
  const user = await db.user.findFirstOrThrow({
    where: { role: "admin", active: true },
  });
  const actor = await teamActor(user, "legacy-team");
  const channel = await db.channel.create({
    data: {
      name: "Review mocked streaming billing",
      provider: "deepseek",
      baseUrl: "https://mock.invalid",
      ciphertext: encrypt("mock"),
      models: {
        text: ["stream-test"],
        search: ["web-search"],
        video_understanding: ["video-test"],
      },
    },
  });
  await db.purchaseRate.create({
    data: {
      channelId: channel.id,
      model: "stream-test",
      kind: "text",
      version: 1,
      unit: "token",
      rate: 1,
      inputRate: 1,
      basis: "Local deterministic fixture, not supplier pricing",
      createdBy: user.id,
    },
  });
  const originalFetch = global.fetch;
  let calls = 0,
    finish!: () => void;
  const rest = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const encode = (v: unknown) =>
    new TextEncoder().encode(
      `data: ${typeof v === "string" ? v : JSON.stringify(v)}\n\n`,
    );
  global.fetch = async () => {
    calls++;
    return new Response(
      new ReadableStream({
        async start(c) {
          c.enqueue(encode({ choices: [{ delta: { content: "first" } }] }));
          await rest;
          c.enqueue(
            encode({
              choices: [{ delta: { content: "second" } }],
              usage: { prompt_tokens: 10, completion_tokens: 2 },
            }),
          );
          c.enqueue(encode("[DONE]"));
          c.close();
        },
      }),
    );
  };
  try {
    await withTeam(actor.teamId, async () => {
      const id = "review-stream:" + randomUUID();
      const input = {
        model: "stream-test",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 32,
      };
      const response = await meteredStream(actor, id, channel.id, input);
      const reader = response.body!.getReader();
      assert(
        new TextDecoder().decode((await reader.read()).value).includes("first"),
      );
      assert.equal(
        (
          await db.usageRecord.findUniqueOrThrow({
            where: { invocationId: id },
          })
        ).status,
        "submitting",
      );
      finish();
      while (!(await reader.read()).done) {}
      const usage = await db.usageRecord.findUniqueOrThrow({
        where: { invocationId: id },
      });
      assert.equal(usage.status, "settled");
      assert.equal(usage.charged?.toString(), "0.0012");
      const replay = await meteredStream(actor, id, channel.id, input);
      assert((await replay.text()).includes("second"));
      assert.equal(calls, 1);
      console.log(
        "PASS streamed before completion; usage settled once; replay makes no provider call",
      );
      global.fetch = async () => {
        calls++;
        throw new Error("simulated ambiguous submission");
      };
      const interrupted = "review-interrupted:" + randomUUID();
      await assert.rejects(
        meteredStream(actor, interrupted, channel.id, input),
      );
      await assert.rejects(
        meteredStream(actor, interrupted, channel.id, input),
        (e: any) => e.status === 409,
      );
      assert.equal(calls, 2);
      assert.equal(
        (
          await db.usageRecord.findUniqueOrThrow({
            where: { invocationId: interrupted },
          })
        ).status,
        "reconcile",
      );
      console.log(
        "PASS ambiguous streamed submission retains reservation and cannot repurchase",
      );
    });
    await withTeam(actor.teamId, async () => {
      await saveRate(actor, {
        channelId: channel.id,
        model: "web-search",
        kind: "search",
        unit: "request",
        rate: 0.01,
        basis: "Local test fixture",
      });
      await saveRate(actor, {
        channelId: channel.id,
        model: "video-test",
        kind: "video_understanding",
        unit: "token",
        rate: 1,
        inputRate: 1,
        cachedInputRate: 1,
        basis: "Local test fixture",
      });
      const videoId = "review-video:" + randomUUID();
      const response = await meteredOperation(
        actor,
        videoId,
        channel.id,
        "video_understanding",
        "video-test",
        { max_tokens: 32 },
        async () => ({ usage: { input_tokens: 10, output_tokens: 2 } }),
      );
      assert(response.usage);
      assert.equal(
        (
          await db.usageRecord.findUniqueOrThrow({
            where: { invocationId: videoId },
          })
        ).charged?.toString(),
        "0.0012",
      );
      console.log(
        "PASS administrators can price search/video understanding; Ark usage settles correctly",
      );
    });
    const other = await db.team.create({
      data: {
        name: "Review attachment tenant " + randomUUID(),
        createdBy: user.id,
      },
    });
    await db.teamMember.create({
      data: {
        teamId: other.id,
        userId: user.id,
        role: "owner",
        createdAt: new Date("2100-01-01"),
      },
    });
    const otherActor = await teamActor(user, other.id);
    const c = await withTeam(
      other.id,
      async () =>
        await db.conversation.create({
          data: { ownerId: user.id, title: "Private team conversation" },
        }),
    );
    const file = await withTeam(
      other.id,
      async () =>
        await db.fileObject.create({
          data: {
            conversationId: c.id,
            key: "review/no-upload/" + randomUUID(),
            name: "test.txt",
            mime: "text/plain",
            bytes: 1,
            createdBy: user.id,
          },
        }),
    );
    await withTeam(other.id, () =>
      db.$transaction((tx) =>
        appendEvent(tx, c.id, "run", { status: "completed" }),
      ),
    );
    await assert.rejects(
      conversationAccess(actor, c.id),
      (e: any) => e.status === 404,
    );
    await assert.rejects(
      fileAccess(actor, file.id),
      (e: any) => e.status === 404,
    );
    await withTeam(actor.teamId, async () => {
      assert.equal(
        await db.agentEvent.count({ where: { conversationId: c.id } }),
        0,
      );
      assert.equal(await db.fileObject.count({ where: { id: file.id } }), 0);
    });
    await withTeam(other.id, async () => {
      assert.equal((await fileAccess(otherActor, file.id)).teamId, other.id);
      assert.equal(
        await db.agentEvent.count({ where: { conversationId: c.id } }),
        1,
      );
    });
    console.log(
      "PASS same user cannot read private conversation, attachment or events across teams",
    );
  } finally {
    finish();
    global.fetch = originalFetch;
    await db.channel.update({
      where: { id: channel.id },
      data: { enabled: false },
    });
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
