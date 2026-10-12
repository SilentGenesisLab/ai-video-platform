// Explicit opt-in: one Bocha search and one short Doubao video analysis.
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const base = process.env.APP_URL!;
let cookie = "";
async function api(path: string, body?: unknown, key = randomUUID()) {
  const response = await fetch(base + "/api/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (path === "/auth/login")
    cookie = response.headers.get("set-cookie")!.split(";")[0];
  const data = await response.json();
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return data;
}
async function main() {
  assert(
    process.env.LIVE_ASSISTANT === "1",
    "Set LIVE_ASSISTANT=1 to authorize the paid smoke test",
  );
  await api("/auth/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  const key = randomUUID();
  const search = await api(
    "/tools/web-search",
    { query: "火山方舟 视频理解 官方文档", count: 3 },
    key,
  );
  assert.equal(search.status, "completed", search.message);
  assert(search.sources.length > 0);
  const repeat = await api(
    "/tools/web-search",
    { query: "火山方舟 视频理解 官方文档", count: 3 },
    key,
  );
  assert.deepEqual(repeat, search);
  console.log("PASS live Bocha search, actual sources and idempotent replay");
  const dir = await mkdtemp(join(tmpdir(), "assistant-smoke-"));
  try {
    const path = join(dir, "silent-colors.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x240:d=3",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x240:d=3",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      path,
    ]);
    let bytes = await readFile(path);
    if (process.env.LIVE_LARGE_VIDEO === "1") {
      const padding = Buffer.alloc(51 * 1024 * 1024);
      padding.writeUInt32BE(padding.length, 0);
      padding.write("free", 4);
      bytes = Buffer.concat([bytes, padding]); // Legal MP4 free atom exercises the Files API with six seconds of video.
    }
    const c = await api("/conversations", { title: "助手实测 · 无声双色短片" });
    const upload = await api("/files", {
      conversationId: c.id,
      name: "silent-colors.mp4",
      mime: "video/mp4",
      bytes: bytes.length,
    });
    const fileId = upload.file?.id ?? upload.id;
    const put = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: upload.headers,
      body: bytes,
    });
    assert(put.ok, "OSS upload");
    await api(`/files/${fileId}/complete`, {});
    assert.equal((await api(`/files/${fileId}`)).parseStatus, "deferred");
    const analysis = await api(`/files/${fileId}/analyses`, {
      prompt:
        "只描述这个六秒测试片的颜色及先后变化；没有营销信息就说明没有。不要编造语音。",
    });
    const until = Date.now() + 240000;
    let job: any;
    do {
      job = await api(`/jobs/${analysis.jobId}`);
      if (["succeeded", "failed", "submission_unknown"].includes(job.status))
        break;
      await new Promise((r) => setTimeout(r, 1500));
    } while (Date.now() < until);
    assert.equal(job.status, "succeeded", job.error ?? "video timeout");
    const result = (await api(`/files/${fileId}/analyses`)).items[0];
    assert.equal(result.model, "doubao-seed-2-1-pro-260628");
    assert(result.rawResponse && result.result.fileHash);
    if (process.env.LIVE_LARGE_VIDEO === "1")
      assert(result.providerFileId, "large input uses Ark Files API");
    assert.equal(result.result.transcript, null);
    assert(result.result.duration >= 5.9 && result.result.duration <= 6.1);
    assert(
      result.result.shots.every(
        (s: any) => s.start >= 0 && s.end <= result.result.duration,
      ),
    );
    assert(
      /红|red/i.test(JSON.stringify(result.result)) &&
        /蓝|blue/i.test(JSON.stringify(result.result)),
    );
    console.log(
      "PASS live Doubao pinned model: red then blue, six seconds, silent input, bounded timestamps, raw response and usage saved",
    );
    const again = await api(`/files/${fileId}/analyses`, {
      prompt: result.prompt,
    });
    assert.equal(again.id, result.id);
    console.log(
      "PASS identical video question reuses analysis without another model call",
    );
    // Import our own signed public OSS URL to verify stable source ingestion, with no extra inference.
    const f = await api(`/files/${fileId}`);
    const imported = await api(`/conversations/${c.id}/imports`, {
      url: f.url,
    });
    let importedJob: any;
    do {
      importedJob = await api(`/jobs/${imported.id ?? imported.jobId}`);
      if (["succeeded", "failed"].includes(importedJob.status)) break;
      await new Promise((r) => setTimeout(r, 1000));
    } while (Date.now() < until);
    assert.equal(importedJob.status, "succeeded", importedJob.error);
    assert.equal(
      (await api(`/files/${importedJob.result.fileId}`)).parseStatus,
      "deferred",
    );
    console.log(
      "PASS HTTPS video import persists to OSS without premature analysis",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
