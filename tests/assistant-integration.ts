import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { digest, encrypt, randomToken } from "../src/lib/security";
import { recordRunEvent } from "../src/lib/run-events";
import { conversationAccess, fileAccess } from "../src/lib/access";
import { controlRun, conversationSnapshot } from "../src/lib/agent";
import { roles, type Actor } from "../src/lib/auth";
import { initiateUpload, completeUpload, oss } from "../src/lib/storage";
import { saveToProduct, readContent } from "../src/lib/attachments";
import { saveResource } from "../src/lib/services";
const base = process.env.APP_URL!;
let checks = 0;
function check(value: unknown, label: string) {
  assert(value, label);
  checks++;
  console.log("PASS " + label);
}
async function main() {
  const user = await db.user.findFirstOrThrow({
    where: { role: "admin", active: true },
  });
  const actor: Actor = {
    id: user.id,
    userId: user.id,
    name: user.name,
    type: "human",
    role: "admin",
    scopes: roles.admin,
    productIds: [],
  };
  const c = await db.conversation.create({
    data: { ownerId: user.id, title: "助手接口验收 · 流恢复与私有附件" },
  });
  const other = await db.conversation.create({
    data: { ownerId: "isolated-test-user", title: "助手接口验收 · 隔离" },
  });
  const token = randomToken("avr_");
  const run = await db.agentRun.create({
    data: {
      conversationId: c.id,
      ownerId: user.id,
      prompt: "No model invocation",
      status: "running",
      attempt: 1,
      tokenHash: digest(token),
      tokenCiphertext: encrypt(token),
      scopes: ["read", "write"],
      productIds: [],
      leaseUntil: new Date(Date.now() + 3600000),
    },
  });
  const runner: Actor = { ...actor, type: "agent", runId: run.id };
  try {
    await assert.rejects(
      () => conversationAccess(runner, other.id),
      (e: any) => e.status === 403,
    );
    check(true, "run cannot access another conversation even with admin owner");
    await assert.rejects(
      () =>
        conversationAccess(
          { ...runner, runId: undefined, productIds: ["unrelated-product"] },
          c.id,
        ),
      (e: any) => e.status === 403,
    );
    check(true, "product-scoped key cannot access an unbound conversation");
    const messageId = randomUUID();
    await recordRunEvent(run.id, token, {
      type: "message_start",
      messageId,
      eventKey: "1:start",
      attempt: 1,
    });
    const delta = {
      type: "delta",
      messageId,
      text: "部分正文",
      eventKey: "1:delta",
      attempt: 1,
    };
    await Promise.all([
      recordRunEvent(run.id, token, delta),
      recordRunEvent(run.id, token, delta),
    ]);
    check(
      (await db.message.findUniqueOrThrow({ where: { id: messageId } }))
        .text === "部分正文",
      "concurrent duplicate deltas append once",
    );
    await assert.rejects(
      () => recordRunEvent(run.id, token, { ...delta, attempt: 0 }),
      (e: any) => e.status === 409,
    );
    check(true, "stale execution attempt rejected");
    const snapshot = await conversationSnapshot(actor, c.id);
    const abort = new AbortController();
    const response = await fetch(
      `${base}/api/v1/conversations/${c.id}/events?after=0`,
      { headers: { Authorization: "Bearer " + token }, signal: abort.signal },
    );
    check(
      response.ok &&
        response.headers.get("content-type")?.includes("text/event-stream"),
      "authorized SSE and no-buffer headers",
    );
    const reader = response.body!.getReader();
    let text = "";
    const deadline = setTimeout(() => abort.abort(), 10000);
    try {
      while (!text.includes('"type":"delta"')) {
        const p = await reader.read();
        if (p.done) break;
        text += new TextDecoder().decode(p.value);
      }
    } finally {
      clearTimeout(deadline);
      abort.abort();
    }
    check(
      text.includes('"type":"message_start"') &&
        text.includes('"type":"delta"'),
      "SSE cursor replay contains persisted deltas in order",
    );
    const after = new AbortController();
    const replay = await fetch(
      `${base}/api/v1/conversations/${c.id}/events?after=${snapshot.cursor}`,
      { headers: { Authorization: "Bearer " + token }, signal: after.signal },
    );
    const pendingRead = replay.body!.getReader().read();
    await recordRunEvent(run.id, token, {
      ...delta,
      text: "新的正文",
      eventKey: "1:next",
    });
    await pendingRead;
    // Initial heartbeat may precede the next event; the durable database cursor remains the assertion source.
    after.abort();
    const newer = await db.agentEvent.findMany({
      where: { conversationId: c.id, seq: { gt: BigInt(snapshot.cursor) } },
    });
    check(
      newer.length === 1 && newer[0].type === "delta",
      "snapshot cursor excludes already delivered events",
    );
    const waiting = await db.job.create({
      data: {
        conversationId: c.id,
        kind: "parse",
        status: "queued",
        phase: "parse",
        input: {},
        leaseUntil: new Date(Date.now() + 3600000),
      },
    });
    await db.agentRun.update({
      where: { id: run.id },
      data: { inputJobIds: [waiting.id] },
    });
    await controlRun(actor, run.id, "stop");
    check(
      (await db.message.findUniqueOrThrow({ where: { id: messageId } }))
        .status === "stopped",
      "stop retains partial text and marks it stopped",
    );
    await controlRun(actor, run.id, "continue");
    check(
      (await db.agentRun.findUniqueOrThrow({ where: { id: run.id } }))
        .status === "waiting_inputs",
      "continue waits for pending attachments instead of restarting the model",
    );
    await assert.rejects(
      () => recordRunEvent(run.id, token, delta),
      (e: any) => e.status === 401,
    );
    check(true, "old lease token cannot publish after continue");
    await controlRun(actor, run.id, "stop");
    const content = Buffer.from("段落一\n段落二\n可追溯资料");
    const upload = await db.$transaction((tx) =>
      initiateUpload(
        actor,
        {
          conversationId: c.id,
          name: "assistant-fixture.txt",
          mime: "text/plain",
          bytes: content.length,
        },
        tx,
      ),
    );
    await oss().put(upload.file.key, content, { mime: "text/plain" });
    const file = await completeUpload(actor, upload.file.id);
    check(
      file.parseStatus === "deferred" && !file.productId,
      "confirmed conversation upload remains deferred",
    );
    check(
      (await db.job.count({
        where: { input: { path: ["fileId"], equals: file.id } },
      })) === 0,
      "upload alone creates no analysis job",
    );
    await assert.rejects(
      () =>
        fileAccess(
          { ...runner, userId: "isolated-test-user", runId: undefined },
          file.id,
        ),
      (e: any) => e.status === 403,
    );
    check(true, "cross-owner file content and URLs denied");
    await db.fileObject.update({
      where: { id: file.id },
      data: { extractedText: content.toString(), parseStatus: "completed" },
    });
    const page = await readContent(actor, file.id, 0, 4);
    check(
      page.text === content.toString().slice(0, 4) && page.nextCursor === 4,
      "content paging preserves offsets",
    );
    const product = await db.$transaction((tx) =>
      saveResource(
        actor,
        "product",
        { title: "助手接口验收 · 保存资料", content: {} },
        tx,
      ),
    );
    const saved = await db.$transaction((tx) =>
      saveToProduct(
        actor,
        file.id,
        { productId: product.id, baseVersion: 1 },
        tx,
      ),
    );
    check(
      saved.file.sourceFileId === file.id &&
        saved.product.version === 2 &&
        saved.file.key !== file.key,
      "saving to product creates independent immutable reference and revision",
    );
    await assert.rejects(
      () =>
        db.$transaction((tx) =>
          saveToProduct(
            actor,
            file.id,
            { productId: product.id, baseVersion: 1 },
            tx,
          ),
        ),
      (e: any) => e.status === 409,
    );
    check(true, "save-to-product rejects stale base version");
    check(
      (await db.fileObject.findUniqueOrThrow({ where: { id: file.id } }))
        .conversationId === c.id,
      "saving never broadens original private file scope",
    );
    await db.resource.update({
      where: { id: product.id },
      data: { status: "archived" },
    });
    await db.job.update({
      where: { id: waiting.id },
      data: { status: "canceled" },
    });
    console.log(
      `Assistant integration: ${checks} checks passed; no model calls.`,
    );
  } finally {
    await db.agentRun.update({
      where: { id: run.id },
      data: { status: "stopped", stopRequested: true },
    });
    await db.job.updateMany({
      where: { conversationId: c.id, status: "queued" },
      data: { status: "canceled" },
    });
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
