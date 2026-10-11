import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { db } from "../src/lib/db";
async function main() {
  const state = JSON.parse(await readFile(".runtime/live-smoke.json", "utf8"));
  const shot = {
    id: "test",
    number: 1,
    duration: 5,
    description: "Placeholder recovery test",
    imageFileId: state.imageFile,
  };
  const input = {
    resourceId: state.board,
    version: 2,
    content: {
      shots: Array.from({ length: 10 }, (_, i) => ({
        ...shot,
        id: "test-" + i,
        number: 10 - i,
        ...(i ? { imageFileId: undefined } : {}),
      })),
    },
  };
  const saved = JSON.parse(JSON.stringify(input));
  const job = await db.$transaction(async (tx) => {
    const j = await tx.job.create({
      data: {
        kind: "overview",
        productId: state.product,
        input: saved,
        updatedAt: new Date(Date.now() - 120000),
      },
    });
    await tx.outbox.create({
      data: { jobId: j.id, phase: "overview", deliveredAt: new Date() },
    });
    return j;
  });
  // This durable message was marked delivered but does not exist in Redis, simulating queue loss.
  for (let i = 0; i < 45; i++) {
    const current = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    if (current.status === "failed")
      throw new Error(current.error ?? "Overview failed");
    if (current.status === "succeeded") {
      const files = (current.result as any).files;
      assert.equal(files.length, 2);
      const stored = await db.fileObject.findMany({
        where: { id: { in: files.map((f: any) => f.fileId) } },
      });
      assert(
        stored.every(
          (f) =>
            f.status === "ready" && f.sha256 && f.key.startsWith("aivideo/"),
        ),
      );
      assert((await db.outbox.count({ where: { jobId: job.id } })) >= 2);
      console.log(
        "PASS missing Redis message recovered from PostgreSQL, ten unordered shots produce two stored contact-sheet pages with placeholders",
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Durable recovery did not finish within 45 seconds");
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
