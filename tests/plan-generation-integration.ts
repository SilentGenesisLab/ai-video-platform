import assert from "node:assert/strict";
import { systemDb as db, withTeam } from "../src/lib/db";
import { teamActor } from "../src/lib/auth";
import { requestPlan, persistPlan } from "../src/lib/plan-generation";
import { saveResource } from "../src/lib/services";
assert(
  process.env.DATABASE_URL?.includes("127.0.0.1:55432/"),
  "Local rollback test only",
);
process.env.N8N_PLAN_SECRET ||= "test-secret";
process.env.N8N_PLAN_WEBHOOK_URL ||= "https://n8n.example.test/webhook/plan";
async function main() {
  const user = await db.user.findFirstOrThrow({
    where: { active: true, platformAdmin: true },
  });
  const actor = await teamActor(user, "legacy-team");
  const rollback = new Error("rollback");
  await assert.rejects(
    withTeam(actor.teamId, () =>
      db.$transaction(
        async (tx) => {
          const product = await saveResource(
            actor,
            "product",
            { title: "Plan test product", content: {} },
            tx,
          );
          const concept = await saveResource(
            actor,
            "concept",
            {
              title: "Plan test concept",
              productId: product.id,
              content: { hook: "old hook" },
            },
            tx,
          );
          await assert.rejects(
            requestPlan(
              { ...actor, type: "agent" },
              concept.id,
              { baseVersion: 1 },
              tx,
            ),
          );
          await assert.rejects(
            requestPlan(
              { ...actor, scopes: ["read"] },
              concept.id,
              { baseVersion: 1 },
              tx,
            ),
          );
          await assert.rejects(
            requestPlan(actor, concept.id, { baseVersion: 2 }, tx),
          );
          const job = await requestPlan(
            actor,
            concept.id,
            {
              baseVersion: 1,
              draft: {
                title: concept.title,
                status: "selected",
                content: { hook: "new hook" },
              },
            },
            tx,
          );
          assert.equal((job.input as any).concept.version, 2);
          assert.equal((job.input as any).concept.content.hook, "new hook");
          await assert.rejects(
            requestPlan(actor, concept.id, { baseVersion: 2 }, tx),
          );
          await saveResource(
            actor,
            "concept",
            {
              title: concept.title,
              baseVersion: 2,
              content: { hook: "human later edit" },
            },
            tx,
            concept.id,
          );
          await tx.job.update({
            where: { id: job.id },
            data: { status: "running" },
          });
          const output = {
            title: "Generated treatment",
            content: {
              story: "Narrative",
              body: "Full treatment",
              duration: 45,
              aspectRatio: "16:9",
            },
            executionId: "test-execution",
          };
          const result: any = await persistPlan(job.id, output, tx);
          const again: any = await persistPlan(job.id, output, tx);
          assert.equal(result.planId, again.planId);
          const plan = await tx.resource.findUniqueOrThrow({
            where: { id: result.planId },
          });
          assert.equal(plan.parentId, concept.id);
          const revision = await tx.revision.findUniqueOrThrow({
            where: { resourceId_version: { resourceId: plan.id, version: 1 } },
          });
          assert(
            (revision.sources as any[]).some(
              (s) => s.resourceId === concept.id && s.version === 2,
            ),
          );
          assert.equal(
            (await tx.resource.findUniqueOrThrow({ where: { id: concept.id } }))
              .version,
            3,
          );
          assert.equal(
            await tx.resource.count({
              where: { parentId: concept.id, kind: "plan" },
            }),
            1,
          );
          console.log(
            "PASS draft snapshot, stale/duplicate/Agent/reader denied, immutable sources, single plan save",
          );
          throw rollback;
        },
        { timeout: 20000 },
      ),
    ),
    (e) => e === rollback,
  );
  await db.$disconnect();
  console.log("All fixtures rolled back; no model calls or charges");
}
void main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exitCode = 1;
});
