import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { digest } from "../src/lib/security";
import { oss } from "../src/lib/storage";
async function main() {
  const base = process.env.APP_URL!;
  const login = await fetch(base + "/api/v1/auth/login", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  assert(login.ok);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  async function api(path: string, method = "GET", body?: unknown) {
    const r = await fetch(base + "/api/v1" + path, {
      method,
      headers: {
        Origin: base,
        Cookie: cookie,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    assert(r.ok, JSON.stringify(data));
    return data;
  }
  const product = (await api("/products")).items.find((p: any) =>
    p.title.includes("极简桌面灯"),
  );
  assert(product);
  const buffer = Buffer.from("Upload integrity and extraction acceptance.");
  const upload = await api("/files", "POST", {
    productId: product.id,
    name: "upload-acceptance.txt",
    mime: "text/plain",
    bytes: buffer.length,
  });
  const renewed = await api(
    "/files/" + upload.file.id + "/upload-url",
    "POST",
    {},
  );
  assert(renewed.uploadUrl);
  const put = await fetch(renewed.uploadUrl, {
    method: "PUT",
    headers: renewed.headers,
    body: buffer,
  });
  assert(put.ok);
  const ready = await api("/files/" + upload.file.id + "/complete", "POST", {});
  assert.equal(ready.sha256, digest(buffer));
  assert.notEqual(ready.key, upload.file.key);
  const overwrite = await fetch(renewed.uploadUrl, {
    method: "PUT",
    headers: renewed.headers,
    body: Buffer.alloc(buffer.length, 120),
  });
  assert(overwrite.ok);
  const delivered = await api("/files/" + upload.file.id);
  const actual = Buffer.from(await (await fetch(delivered.url)).arrayBuffer());
  assert.equal(digest(actual), digest(buffer));
  console.log(
    "PASS staging upload cannot overwrite an accepted immutable file; signed upload renewal and SHA-256 verified",
  );
  const expired = oss().signatureUrl(upload.file.key, { expires: 1 });
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal((await fetch(expired)).status, 403);
  console.log("PASS expired OSS signature rejected");
  for (let i = 0; i < 15; i++) {
    const file = await db.fileObject.findUniqueOrThrow({
      where: { id: upload.file.id },
    });
    if (file.parseStatus === "completed") {
      assert.equal(file.extractedText, buffer.toString());
      console.log("PASS async original-material text extraction");
      return;
    }
    assert.notEqual(file.parseStatus, "failed");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Material extraction did not finish in test window");
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
