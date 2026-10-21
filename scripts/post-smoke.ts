import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { copyFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { renderPost, buildEdl } from "../src/lib/film-post";
import type { PostInput } from "../src/lib/film-post";

/**
 * 本机端到端：用惠芯 v5 的真实素材跑一遍 renderPost，不碰 OSS。
 * 素材目录挂成本地 HTTP，因为模块只接受 URL（生产就是 OSS 签名链接）。
 */

const ROOT = "L:/视频制作/惠芯V3-剪辑";
const VOICE = "L:/视频制作/_n8n_tmp/hx_v3_out/_r3/vo2";
const MASTER = "L:/视频制作/_n8n_tmp/film_post_smoke_master.mp4";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
};

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(normalize(ROOT))) {
    res.writeHead(403).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
});

const fps = 24;

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;

  const segments = [
    [0, 59, 6], [141, 203, 8], [203, 266, 8], [266, 337, 7], [421, 471, 6],
    [477, 591, 11], [591, 637, 5], [637, 660, 3], [675, 773, 12],
  ].map(([a, b, beats]) => ({ in: a / fps, out: b / fps, beats }));

  const voiceAt = [0.5, 3.042, 13.333, 16.0, 20.958, 24.542];

  const input: PostInput = {
    source: `${base}/work/picture_only.mp4`,
    music: `${base}/score/tmp/out_mus1.wav`,
    voice: [],
    segments,
    beat: { bpm: 134.012, phase: 0.344 },
    fps,
    width: 1280,
    height: 720,
    grade: { targetRb: -12, contrast: 1.05, saturation: 1.04 },
    delivery: { lufs: -16, dbtp: -1.5, crf: 12 },
  };

  const edl = buildEdl(input.segments, input.beat, input.fps);
  console.log(`EDL ${edl.total} 帧 / ${(edl.total / fps).toFixed(3)}s，${edl.shots.length} 段`);
  console.log("cuts", edl.bounds.slice(1).map((f) => (f / fps).toFixed(3)).join(" "));

  const out = await mkdtemp(join(tmpdir(), "film-post-smoke-"));

  // 人声文件单独放，用第二个挂载点
  const voiceServer = createServer((req, res) => {
    const file = normalize(join(VOICE, decodeURIComponent((req.url ?? "/").split("?")[0])));
    res.writeHead(200, { "content-type": "audio/wav" });
    createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
  await new Promise<void>((resolve) => voiceServer.listen(0, "127.0.0.1", resolve));
  const voiceBase = `http://127.0.0.1:${(voiceServer.address() as any).port}`;

  input.voice = voiceAt.map((at, index) => ({
    url: `${voiceBase}/l0${index + 1}.wav`,
    at,
  }));

  const started = Date.now();
  const report = await renderPost(input, out);
  console.log(`渲染 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  await copyFile(join(out, "master.mp4"), MASTER);

  console.log(JSON.stringify(report, null, 2));

  server.close();
  voiceServer.close();

  const failed = report.checks.filter((check) => !check.ok);
  if (failed.length) {
    console.error("自检未通过:", failed.map((f) => `${f.name} ${f.detail}`).join("; "));
    process.exitCode = 1;
  } else {
    console.log(`自检通过，母版在 ${MASTER}`);
  }
}

main().catch((error) => {
  console.error(error);
  server.close();
  process.exit(1);
});
