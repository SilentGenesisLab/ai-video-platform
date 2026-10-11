import { strict as assert } from "node:assert";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { db } from "../src/lib/db";
const base = process.env.APP_URL!;
async function main() {
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
  async function human(path: string, method = "POST", body: unknown = {}) {
    const r = await fetch(base + "/api/v1" + path, {
      method,
      headers: {
        Origin: base,
        Cookie: cookie,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      ...(method !== "DELETE" ? { body: JSON.stringify(body) } : {}),
    });
    assert(r.ok);
    return r.json();
  }
  const key = await human("/api-keys", "POST", {
    name: "Skill 安装验收（自动撤销）",
    scopes: ["read"],
  });
  try {
    const { instructions } = await human(
      "/api-keys/" + key.id + "/connection-instructions",
    );
    const token = /AIVIDEO_API_KEY=(\S+)/.exec(instructions)![1];
    const root = resolve(".runtime/skill-install/" + randomUUID());
    const response = await fetch(base + "/skills/ai-video-platform.zip");
    assert(response.ok);
    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    for (const [name, bytes] of Object.entries(entries)) {
      assert(!name.includes("..") && !name.startsWith("/"));
      assert(!Buffer.from(bytes).includes(Buffer.from(token)));
      const target = join(root, name);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, bytes);
    }
    const entry = await readFile(
      join(root, "ai-video-platform/SKILL.md"),
      "utf8",
    );
    assert(entry.includes("version: 1.0.0"));
    assert(entry.includes("auth/me"));
    await writeFile(
      join(root, "private.env"),
      `AIVIDEO_BASE_URL=${base}\nAIVIDEO_API_KEY=${token}\n`,
      { mode: 0o600 },
    );
    const before = await db.job.count();
    const me = await fetch(base + "/api/v1/auth/me", {
      headers: { Authorization: "Bearer " + token },
    });
    const identity = await me.json();
    assert(me.ok);
    assert.deepEqual(identity.scopes, ["read"]);
    assert.equal(await db.job.count(), before);
    console.log(
      "PASS installed credential-free Skill ZIP, saved private configuration, verified identity without creating jobs",
    );
  } finally {
    await human("/api-keys/" + key.id, "DELETE");
  }
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
