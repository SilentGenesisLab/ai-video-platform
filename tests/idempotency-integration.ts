import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { digest, encrypt, randomToken } from "../src/lib/security";

async function main() {
  const owner = await db.user.findFirstOrThrow({
    where: { role: "admin", active: true },
  });
  const token = randomToken();
  const key = await db.apiKey.create({
    data: {
      ownerId: owner.id,
      name: "Review replay regression",
      prefix: token.slice(0, 12),
      hash: digest(token),
      ciphertext: encrypt(token),
      scopes: ["read", "write"],
      productIds: [],
    },
  });
  let conversationId: string | undefined;
  let fileId: string | undefined;
  async function request(path: string, body: unknown, idempotencyKey: string) {
    return fetch(process.env.APP_URL + "/api/v1" + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  }
  try {
    const conversationKey = randomUUID(),
      fileKey = randomUUID();
    const conversationBody = { title: "Review unbound conversation" };
    const created = await request(
      "/conversations",
      conversationBody,
      conversationKey,
    );
    assert.equal(created.status, 201);
    conversationId = (await created.json()).id;
    const fileBody = {
      conversationId,
      name: "review.txt",
      mime: "text/plain",
      bytes: 10,
    };
    const uploaded = await request("/files", fileBody, fileKey);
    assert.equal(uploaded.status, 201);
    fileId = (await uploaded.json()).file.id;
    const replay = await request("/files", fileBody, fileKey);
    assert.equal(replay.status, 201);
    assert.equal((await replay.json()).file.id, fileId);
    console.log(
      "PASS authorized upload replay returns the same file without another upload",
    );

    await db.apiKey.update({
      where: { id: key.id },
      data: { productIds: [randomUUID()] },
    });
    assert.equal(
      (await request("/conversations", conversationBody, conversationKey))
        .status,
      403,
    );
    assert.equal((await request("/files", fileBody, fileKey)).status, 403);
    console.log(
      "PASS tightened product scope denies cached unbound conversation and signed upload",
    );

    await db.apiKey.update({
      where: { id: key.id },
      data: { productIds: [], scopes: ["read"] },
    });
    assert.equal(
      (await request("/conversations", conversationBody, conversationKey))
        .status,
      403,
    );
    assert.equal((await request("/files", fileBody, fileKey)).status, 403);
    console.log("PASS revoked write scope denies cached creation requests");

    await db.apiKey.update({ where: { id: key.id }, data: { scopes: [] } });
    assert.equal(
      (
        await fetch(process.env.APP_URL + "/api/v1/conversations", {
          headers: { Authorization: "Bearer " + token },
        })
      ).status,
      403,
    );
    console.log("PASS conversation listing requires read permission");
  } finally {
    // These records contain no uploaded media, runs, or generated content.
    await db.idempotency.deleteMany({ where: { actorId: key.id } });
    if (fileId) await db.fileObject.delete({ where: { id: fileId } });
    if (conversationId)
      await db.conversation.delete({ where: { id: conversationId } });
    await db.apiKey.delete({ where: { id: key.id } });
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
