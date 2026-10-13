import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { systemDb as db, withTeam } from "../src/lib/db";
import { teamActor } from "../src/lib/auth";
import {
  createConversation,
  sendMessage,
  conversationMedia,
} from "../src/lib/agent";
import {
  generateMedia,
  refreshVideoQuote,
  decideBatch,
} from "../src/lib/production";
const u = new URL(process.env.DATABASE_URL!);
assert.equal(u.hostname, "127.0.0.1");
assert.equal(u.port, "55432");
async function main() {
  const user = await db.user.findFirstOrThrow({
    where: { platformAdmin: true, active: true },
  });
  const actor = await teamActor(user, "legacy-team");
  const rollback = new Error("rollback fixture");
  await assert.rejects(
    withTeam(actor.teamId, () =>
      db.$transaction(
        async (tx) => {
          const p = await tx.resource.create({
            data: {
              teamId: actor.teamId,
              kind: "product",
              title: "Reference fixture",
              content: {},
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
          await tx.revision.create({
            data: {
              resourceId: p.id,
              version: 1,
              title: p.title,
              status: p.status,
              content: p.content!,
              sources: [],
              actorId: user.id,
              actorType: "human",
            },
          });
          const ref = await tx.resource.create({
            data: {
              teamId: actor.teamId,
              kind: "concept",
              productId: p.id,
              title: "Selected concept",
              content: { hook: "old hook" },
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
          const c = await createConversation(actor, { productId: p.id }, tx);
          const run = await sendMessage(
            actor,
            c.id,
            { text: "编辑这条创意", referenceIds: [ref.id] },
            tx,
          );
          const message = await tx.message.findFirstOrThrow({
            where: { runId: run.id, role: "user" },
          });
          const refs = message.contextRefs as any[];
          assert.equal(refs[0].resourceId, ref.id);
          assert.equal(refs[0].content.hook, "old hook");
          assert.equal(refs[0].version, 1);
          console.log(
            "PASS explicit references snapshot original object and version",
          );
          const other = await tx.resource.create({
            data: {
              teamId: actor.teamId,
              kind: "product",
              title: "Other product",
              content: {},
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
          const another = await createConversation(
            actor,
            { productId: p.id },
            tx,
          );
          await assert.rejects(() =>
            sendMessage(
              actor,
              another.id,
              { text: "edit", referenceIds: [other.id] },
              tx,
            ),
          );
          console.log("PASS cross-product reference rejected");
          const runActor = {
            ...actor,
            id: run.id,
            userId: run.id,
            type: "agent" as const,
            runId: run.id,
          };
          const image = await generateMedia(
            runActor,
            {
              kind: "image",
              productId: p.id,
              prompt: "fixture image",
              title: "Image fixture",
            },
            tx,
          );
          assert.equal(image.status, "queued");
          assert.equal(await tx.job.count({ where: { batchId: image.id } }), 1);
          assert.equal(
            await tx.outbox.count({
              where: {
                jobId: (
                  await tx.job.findFirstOrThrow({
                    where: { batchId: image.id },
                  })
                ).id,
              },
            }),
            1,
          );
          const video = await generateMedia(
            runActor,
            { kind: "video", productId: p.id, prompt: "fixture video" },
            tx,
          );
          assert.equal(video.status, "pending_approval");
          assert.equal(await tx.job.count({ where: { batchId: video.id } }), 0);
          const cards = await conversationMedia(actor, c.id, tx);
          assert.equal(cards.items.length, 2);
          assert.equal(cards.items.find(b => b.id === video.id)?.canConfirm, true);
          assert.ok(Number(cards.items.find(b => b.id === video.id)?.estimatedCredits) > 0);
          assert.equal(
            cards.items.find((b) => b.id === image.id)?.jobs.length,
            1,
          );
          console.log(
            "PASS automatic channel/quote queues image immediately; video waits for human; conversation recovers both placeholders",
          );
          const editor = {
            ...actor,
            role: "editor",
            scopes: ["read", "write", "generate"],
          };
          const before = await tx.userWallet.findUniqueOrThrow({
            where: { userId: actor.userId },
          });
          const fresh = await refreshVideoQuote(editor, video.id, tx);
          assert.equal(fresh.canConfirm, true);
          assert.equal(fresh.payerIsCurrentUser, true);
          assert.ok(Number(fresh.estimatedCredits) > 0);
          assert.equal(
            (
              await tx.userWallet.findUniqueOrThrow({
                where: { userId: actor.userId },
              })
            ).frozen.toString(),
            before.frozen.toString(),
          );
          assert.equal(await tx.job.count({ where: { batchId: video.id } }), 0);
          await assert.rejects(() =>
            decideBatch(
              runActor,
              video.id,
              { digest: fresh.digest, decision: "approve" },
              tx,
            ),
          );
          await assert.rejects(() =>
            decideBatch(
              editor,
              video.id,
              { digest: video.digest, decision: "approve" },
              tx,
            ),
          );
          const approved = await decideBatch(
            editor,
            video.id,
            { digest: fresh.digest, decision: "approve" },
            tx,
          );
          assert.equal(approved.status, "queued");
          assert.equal(approved.jobs.length, 1);
          const after = await tx.userWallet.findUniqueOrThrow({
            where: { userId: actor.userId },
          });
          assert.equal(after.balance.toString(), before.balance.toString());
          assert.equal(
            after.frozen.sub(before.frozen).toString(),
            fresh.estimatedCredits,
          );
          await assert.rejects(() =>
            decideBatch(
              editor,
              video.id,
              { digest: fresh.digest, decision: "approve" },
              tx,
            ),
          );
          assert.equal(await tx.job.count({ where: { batchId: video.id } }), 1);
          console.log(
            "PASS own human editor consents exact quote; no credits frozen before consent; Agent/stale/double approval blocked",
          );
          throw rollback;
        },
        { timeout: 30000 },
      ),
    ),
    (e) => e === rollback,
  );
  console.log("Rolled back all media tasks: no provider calls, no charges");
}
main().finally(() => db.$disconnect());
