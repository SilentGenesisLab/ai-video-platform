import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { assert } from "./errors";
import { objectKey, oss, readUrl } from "./storage";

/**
 * 成片后期：按节拍重剪 → 逐镜头调色 → 人声铺轨 → 混音 → x265 母版 → 自检。
 *
 * 节拍与分镜由 plan 段给出（人工确认过），这里只做确定性执行：
 * 同一份入参必须产出同一份结果，不给审美判断留隐式分支。
 *
 * 只依赖运行环境的 ffmpeg（本仓库镜像已装 minterpolate / rubberband /
 * colorchannelmixer / loudnorm / alimiter / libx265）。
 */

const exec = promisify(execFile);
const FFMPEG_TIMEOUT = 30 * 60 * 1000;
const SR = 48000;
const ANALYZE_W = 384;
const ANALYZE_H = 216;
const VERIFY_W = 160;
const VERIFY_H = 90;

export type PostSegment = { in: number; out: number; beats: number };
export type PostVoice = { url: string; at: number };

export type PostInput = {
  source: string;
  music: string;
  voice: PostVoice[];
  segments: PostSegment[];
  beat: { bpm: number; phase: number };
  fps: number;
  width: number;
  height: number;
  grade: { targetRb: number; contrast: number; saturation: number };
  delivery: { lufs: number; dbtp: number; crf: number };
  name?: string;
};

export type PostShotReport = {
  index: number;
  in: number;
  out: number;
  beats: number;
  frames: number;
  speed: number;
  rr: number;
  bb: number;
  /** 成片上实测的白点 R−B；该段白像素太少时为 null */
  hiRb: number | null;
  lum: number;
};

export type PostReport = {
  key: string;
  url: string;
  duration: number;
  frames: number;
  bytes: number;
  loudness: { integrated: number | null; truePeak: number | null; lra: number | null };
  voice: { lines: number; tiltDb: number[] };
  shots: PostShotReport[];
  checks: { name: string; ok: boolean; detail: string }[];
};

type Box = { r: number; g: number; b: number; n: number };

async function run(cmd: string, args: string[], timeout = FFMPEG_TIMEOUT) {
  return exec(cmd, args, { timeout, maxBuffer: 64 << 20, encoding: "buffer" });
}

async function ff(args: string[], timeout = FFMPEG_TIMEOUT): Promise<Buffer> {
  const { stdout } = await run("ffmpeg", ["-y", "-nostdin", "-v", "error", ...args], timeout);
  return stdout as Buffer;
}

async function probe(path: string) {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path,
  ], 120000);
  const parsed = JSON.parse(String(stdout));
  const video = (parsed.streams ?? []).find((s: any) => s.codec_type === "video");
  return {
    duration: Number(parsed.format?.duration ?? video?.duration ?? 0),
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    frames: Number(video?.nb_frames ?? 0),
  };
}

async function download(url: string, path: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  assert(response.ok, 502, `素材下载失败 HTTP ${response.status}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

// ---------------------------------------------------------------- 节拍与分镜

export function buildEdl(segments: PostSegment[], beat: { bpm: number; phase: number }, fps: number) {
  const period = 60 / beat.bpm;
  const at = (k: number) => Math.round((beat.phase + k * period) * fps);
  const bounds = [0];
  let current = 0;
  const shots = segments.map((seg, index) => {
    current += seg.beats;
    bounds.push(at(current));
    const start = bounds[index];
    const end = bounds[index + 1];
    const frames = end - start;
    assert(frames > 0, 422, `第 ${index + 1} 个镜头分到 0 帧，检查 beats`);
    const sourceSeconds = seg.out - seg.in;
    assert(sourceSeconds > 0, 422, `第 ${index + 1} 个镜头 in/out 无效`);
    return { index, in: seg.in, out: seg.out, beats: seg.beats, frames, speed: frames / fps / sourceSeconds };
  });
  return { shots, bounds, total: bounds[bounds.length - 1], period };
}

// ---------------------------------------------------------------- 画面

async function renderPicture(
  source: string,
  shots: ReturnType<typeof buildEdl>["shots"],
  target: string,
  fps: number,
  width: number,
  height: number,
) {
  const total = shots.reduce((n, s) => n + s.frames, 0);
  const duration = total / fps;
  const parts = shots.map((shot, i) => {
    const chain = [
      `trim=start=${shot.in.toFixed(6)}:end=${shot.out.toFixed(6)}`,
      "setpts=PTS-STARTPTS",
      `setpts=${shot.speed.toFixed(6)}*PTS`,
      `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`,
      `fps=${fps}`,
      `trim=end_frame=${shot.frames}`,
      "setpts=PTS-STARTPTS",
      `scale=${width}:${height}:flags=lanczos`,
      "setsar=1",
      "format=yuv420p",
    ];
    return `[0:v]${chain.join(",")}[v${i}]`;
  });
  const graph =
    parts.join(";") +
    ";" +
    shots.map((_, i) => `[v${i}]`).join("") +
    `concat=n=${shots.length}:v=1:a=0,` +
    `fade=t=in:st=0:d=0.5,fade=t=out:st=${(duration - 1.2).toFixed(3)}:d=1.2,format=yuv420p[vout]`;
  await ff([
    "-i", source, "-filter_complex", graph, "-map", "[vout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "14",
    "-pix_fmt", "yuv420p", "-r", String(fps), "-an", target,
  ]);
}

// ---------------------------------------------------------------- 调色

function frameStats(buffer: Buffer, width: number, height: number) {
  const n = width * height;
  const rgb = new Float32Array(n * 3);
  let sumR = 0, sumG = 0, sumB = 0;
  for (let i = 0; i < n; i += 1) {
    const r = buffer[i * 3];
    const g = buffer[i * 3 + 1];
    const b = buffer[i * 3 + 2];
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    sumR += r; sumG += g; sumB += b;
  }
  return {
    rgb, n,
    mean: { r: sumR / n, g: sumG / n, b: sumB / n },
    lum: (sumR + sumG + sumB) / (3 * n),
  };
}

type Sample = ReturnType<typeof frameStats>;

/** 在 rr/bb 网格上找把白点 R−B 拉到目标、同时保住亮度的增益对。
 *  白点用绝对阈值（min(R,G,B)≥150），不用"最亮 10%"——暗镜头里那个分档会落到近黑，
 *  测出来的是阴影噪声，不是白。掩膜随候选增益重算，否则会把白推到阈值以下来"作弊"。 */
const WHITE = 150;
const WHITE_MIN = 0.004;

function solveWhiteBalance(samples: Sample[], targetRb: number) {
  const evaluate = (rr: number, bb: number) => {
    let hiRb = 0, judged = 0, clipped = 0, pixels = 0, total = 0;
    for (const s of samples) {
      let hr = 0, hb = 0, hn = 0;
      let sr = 0, sg = 0, sb = 0;
      for (let i = 0; i < s.n; i += 1) {
        const r = Math.min(255, s.rgb[i * 3] * rr);
        const g = s.rgb[i * 3 + 1];
        const b = Math.min(255, s.rgb[i * 3 + 2] * bb);
        if (r >= 254.5 || b >= 254.5) clipped += 1;
        sr += r; sg += g; sb += b;
        if (r >= WHITE && g >= WHITE && b >= WHITE) { hr += r; hb += b; hn += 1; }
      }
      pixels += s.n;
      total += sr + sg + sb;
      if (hn >= s.n * WHITE_MIN) { hiRb += hr / hn - hb / hn; judged += 1; }
    }
    hiRb /= Math.max(1, judged);
    const base = samples.reduce((sum, s) => sum + (s.mean.r + s.mean.g + s.mean.b) * s.n, 0);
    const lumRatio = total / base;
    const clipPct = clipped / Math.max(1, pixels);
    const lost = samples.length - judged;
    const cost =
      (hiRb - targetRb) ** 2 +
      2.5 * (100 * (lumRatio - 1)) ** 2 +
      Math.max(0, clipPct - 0.0035) ** 2 * 9e5 +
      (lost > 0 ? 1e4 * lost : 0);
    return { cost, hiRb, lumRatio, clipped, judged };
  };

  const grid: { rr: number; bb: number; cost: number; hiRb: number; lumRatio: number; clipped: number; judged: number }[] = [];
  for (let rr = 0.94; rr <= 1.2801; rr += 0.02) {
    for (let bb = 0.76; bb <= 1.0701; bb += 0.02) {
      grid.push({ rr, bb, ...evaluate(rr, bb) });
    }
  }
  grid.sort((a, b) => a.cost - b.cost);
  let best = grid[0];
  for (let rr = best.rr - 0.02; rr <= best.rr + 0.0201; rr += 0.005) {
    for (let bb = best.bb - 0.02; bb <= best.bb + 0.0201; bb += 0.005) {
      if (rr < 0.9 || rr > 1.32 || bb < 0.72 || bb > 1.1) continue;
      const candidate = { rr, bb, ...evaluate(rr, bb) };
      if (candidate.cost < best.cost) best = candidate;
    }
  }
  return { rr: Number(best.rr.toFixed(3)), bb: Number(best.bb.toFixed(3)), hiRb: best.hiRb, lum: best.lumRatio };
}

async function sampleShot(picture: string, shot: { frames: number }, offset: number, fps: number) {
  const samples: Sample[] = [];
  for (const ratio of [0.18, 0.42, 0.68, 0.9]) {
    const frame = offset + Math.floor(shot.frames * ratio);
    const buffer = await ff([
      "-ss", (frame / fps).toFixed(4), "-i", picture,
      "-frames:v", "1", "-vf", `scale=${ANALYZE_W}:${ANALYZE_H}`,
      "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ], 120000);
    if (buffer.length >= ANALYZE_W * ANALYZE_H * 3) {
      samples.push(frameStats(buffer, ANALYZE_W, ANALYZE_H));
    }
  }
  return samples;
}

async function gradePicture(
  picture: string,
  shots: ReturnType<typeof buildEdl>["shots"],
  bounds: number[],
  fps: number,
  grade: PostInput["grade"],
  target: string,
) {
  const reports: PostShotReport[] = [];
  const filters: string[] = [];
  for (const shot of shots) {
    const samples = await sampleShot(picture, shot, bounds[shot.index], fps);
    assert(samples.length > 0, 502, `第 ${shot.index + 1} 个镜头取不到画面`);
    const solved = solveWhiteBalance(samples, grade.targetRb);
    const chain =
      `colorchannelmixer=rr=${solved.rr.toFixed(4)}:gg=1.0000:bb=${solved.bb.toFixed(4)},` +
      `eq=contrast=${grade.contrast}:saturation=${grade.saturation}`;
    const start = bounds[shot.index] / fps;
    const end = bounds[shot.index + 1] / fps - 0.0001;
    const window = `between(t,${start.toFixed(6)},${end.toFixed(6)})`;
    filters.push(...chain.split(",").map((f) => `${f}:enable='${window}'`));
    reports.push({
      index: shot.index + 1, in: shot.in, out: shot.out, beats: shot.beats,
      frames: shot.frames, speed: Number(shot.speed.toFixed(3)),
      rr: solved.rr, bb: solved.bb, hiRb: Number(solved.hiRb.toFixed(1)),
      lum: Number((solved.lum * 100).toFixed(1)),
    });
  }
  await ff([
    "-i", picture, "-vf", filters.join(","),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "12",
    "-pix_fmt", "yuv420p", "-r", String(fps), "-an", target,
  ]);
  return reports;
}

// ---------------------------------------------------------------- 人声

function decodeF32(buffer: Buffer) {
  const copy = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return new Float32Array(copy);
}

async function loadMono(path: string) {
  return decodeF32(await ff(["-i", path, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"]));
}

async function loadStereo(path: string) {
  const data = decodeF32(await ff(["-i", path, "-ac", "2", "-ar", String(SR), "-f", "f32le", "-"]));
  return data;
}

/** 3.5 kHz 二阶高通后的能量占比——比"亮不亮"，不需要做 FFT。 */
function brightness(samples: Float32Array) {
  const w = (2 * Math.PI * 3500) / SR;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = (1 + Math.cos(w)) / 2 / a0;
  const b1 = -(1 + Math.cos(w)) / a0;
  const b2 = b0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, high = 0, all = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; high += y * y; all += x * x;
  }
  return all > 0 ? Math.sqrt(high / all) : 0;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function shiftLine(path: string, tiltDb: number) {
  if (Math.abs(tiltDb) <= 0.5) return path;
  const output = path.replace(/\.wav$/, "") + "-norm.wav";
  await ff([
    "-i", path,
    "-af", `treble=g=${(-tiltDb).toFixed(2)}:f=3500:width=1.0`,
    "-ar", String(SR), "-ac", "1", output,
  ]);
  return output;
}

function writeWav(samples: Float32Array, channels: number, path: string) {
  const header = Buffer.alloc(44);
  const bytes = samples.length * 4;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * channels * 4, 28);
  header.writeUInt16LE(channels * 4, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  return writeFile(path, Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, bytes)]));
}

async function buildVoiceStem(lines: PostVoice[], dir: string, duration: number) {
  const total = Math.round(duration * SR);
  const stem = new Float64Array(total);
  const local: string[] = [];
  const brights: number[] = [];
  for (const [index, line] of lines.entries()) {
    const path = join(dir, `vo_${index}.wav`);
    await download(line.url, path);
    local.push(path);
    brights.push(brightness(await loadMono(path)));
  }
  const targetBright = brights.length ? median(brights) : 0;

  // 只对齐亮度：基频中位数在这批素材上换一组窗长就摆动近一个半音，
  // 拿它做变调会把误差直接变成音色抖动。
  const rendered: { at: number; samples: Float32Array }[] = [];
  const tilts: number[] = [];
  for (const [index, path] of local.entries()) {
    let tilt = 0;
    if (targetBright > 0 && brights[index] > 0) {
      tilt = Math.max(-2.5, Math.min(2.5, 6 * Math.log2(brights[index] / targetBright)));
    }
    tilts.push(Number(tilt.toFixed(2)));
    const shifted = await shiftLine(path, tilt);
    rendered.push({ at: lines[index].at, samples: await loadMono(shifted) });
  }

  const rms = rendered.map((r) => Math.sqrt(r.samples.reduce((sum, v) => sum + v * v, 0) / r.samples.length));
  const reference = median(rms.filter((v) => v > 0));
  for (const [index, item] of rendered.entries()) {
    const scaled = new Float32Array(item.samples.length);
    const gain = reference / (rms[index] || reference);
    let peak = 0;
    for (let i = 0; i < item.samples.length; i += 1) {
      scaled[i] = item.samples[i] * gain;
      peak = Math.max(peak, Math.abs(scaled[i]));
    }
    const limit = peak > 0.89 ? 0.89 / peak : 1;
    const fade = Math.round(0.008 * SR);
    const start = Math.round(item.at * SR);
    for (let i = 0; i < scaled.length; i += 1) {
      const position = start + i;
      if (position >= total) break;
      let value = scaled[i] * limit;
      if (i < fade) value *= i / fade;
      if (i > scaled.length - fade) value *= (scaled.length - i) / fade;
      stem[position] += value;
    }
  }
  return { stem: Float32Array.from(stem), tilts, reference };
}

// ---------------------------------------------------------------- 混音

/** 按人声包络压配乐，起音快、释放慢，避免在音节中间抽气。 */
function duckGain(voice: Float32Array, depthDb: number) {
  const hop = Math.round(0.005 * SR);
  const frames = Math.ceil(voice.length / hop);
  const env = new Float32Array(frames);
  let peak = 1e-9;
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    const from = i * hop;
    const to = Math.min(voice.length, from + hop);
    for (let j = from; j < to; j += 1) sum += voice[j] * voice[j];
    const rms = Math.sqrt(sum / Math.max(1, to - from));
    env[i] = rms;
    peak = Math.max(peak, rms);
  }
  const attack = 0.02;
  const release = 0.25;
  const smoothed = new Float32Array(frames);
  let current = 0;
  for (let i = 0; i < frames; i += 1) {
    const target = env[i] / peak;
    const rate = target > current ? attack : release;
    current += (target - current) * (hop / SR / rate);
    smoothed[i] = current;
  }
  const gain = new Float32Array(voice.length);
  for (let i = 0; i < voice.length; i += 1) {
    const level = smoothed[Math.min(frames - 1, Math.floor(i / hop))];
    gain[i] = 10 ** ((-depthDb * level) / 20);
  }
  return gain;
}

async function mixAudio(
  musicPath: string,
  voice: Float32Array,
  voiceRms: number,
  duration: number,
  dir: string,
  bedDb: number,
  duckDepthDb: number,
  delivery: PostInput["delivery"],
) {
  const music = await loadStereo(musicPath);
  const total = Math.round(duration * SR);
  let musicEnergy = 0;
  for (let i = 0; i < music.length; i += 1) musicEnergy += music[i] * music[i];
  const musicRms = Math.sqrt(musicEnergy / Math.max(1, music.length));
  const gain = (voiceRms * 10 ** (-bedDb / 20)) / (musicRms || 1);

  const mixed = new Float32Array(total * 2);
  const duck = duckGain(voice, duckDepthDb);
  for (let i = 0; i < total; i += 1) {
    const left = i * 2 < music.length ? music[i * 2] * gain : 0;
    const right = i * 2 + 1 < music.length ? music[i * 2 + 1] * gain : 0;
    const fade = duck[i] ?? 1;
    mixed[i * 2] = left * fade + (voice[i] ?? 0);
    mixed[i * 2 + 1] = right * fade + (voice[i] ?? 0);
  }
  const rawPath = join(dir, "mix_raw.wav");
  await writeWav(mixed, 2, rawPath);

  const lookahead = Math.round(0.005 * SR);
  const prefix = [`atrim=0:${duration.toFixed(3)}`, "asetpts=PTS-STARTPTS"];
  const peak = delivery.dbtp;
  let report: any = null;
  try {
    const { stderr } = await run("ffmpeg", [
      "-hide_banner", "-nostdin", "-i", rawPath,
      "-af", `${prefix.join(",")},loudnorm=I=${delivery.lufs}:TP=${peak}:LRA=11:print_format=json`,
      "-f", "null", "-",
    ], 300000);
    const text = String(stderr);
    report = JSON.parse(text.slice(text.lastIndexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    report = null;
  }
  const filters = [...prefix];
  filters.push(
    `loudnorm=I=${delivery.lufs}:TP=${peak}:LRA=11` +
      (report
        ? `:measured_I=${report.input_i}:measured_TP=${report.input_tp}` +
          `:measured_LRA=${report.input_lra}:measured_thresh=${report.input_thresh}` +
          `:offset=${report.target_offset ?? "0"}:linear=true`
        : ""),
  );
  filters.push(
    "aresample=192000",
    `alimiter=limit=${(peak - 0.8).toFixed(2)}dB:attack=5:release=60:level=disabled`,
    `aresample=${SR}`,
    `atrim=start_sample=${lookahead}`,
    "apad",
  );
  const out = join(dir, "mix.wav");
  await ff([
    "-i", rawPath, "-af", filters.join(","),
    "-ac", "2", "-ar", String(SR), "-t", duration.toFixed(6), "-c:a", "pcm_s24le", out,
  ]);
  return out;
}

// ---------------------------------------------------------------- 自检

async function measureLoudness(path: string) {
  const { stderr } = await run("ffmpeg", [
    "-hide_banner", "-nostdin", "-i", path,
    "-af", "ebur128=peak=true", "-f", "null", "-",
  ], 600000);
  const text = String(stderr);
  const summary = text.slice(text.lastIndexOf("Summary:"));
  const integrated = /I:\s*(-?[\d.]+|-inf)\s*LUFS/.exec(summary);
  const peakMatch = [...summary.matchAll(/Peak:\s*(-?[\d.]+|-inf)/g)];
  const lra = /LRA:\s*(-?[\d.]+|-inf)\s*LU/.exec(summary);
  const number = (raw: string | undefined) =>
    raw === undefined || raw === "-inf" ? null : Number(raw);
  return {
    integrated: number(integrated?.[1]),
    truePeak: number(peakMatch.length > 1 ? peakMatch[peakMatch.length - 1][1] : peakMatch[0]?.[1]),
    lra: number(lra?.[1]),
  };
}

async function cutLanding(path: string, bounds: number[]) {
  const buffer = await ff([
    "-i", path, "-vf", `scale=${VERIFY_W}:${VERIFY_H}`,
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], 600000);
  const frameSize = VERIFY_W * VERIFY_H * 3;
  const frames = Math.floor(buffer.length / frameSize);
  const deltas = new Float32Array(Math.max(0, frames - 1));
  for (let i = 1; i < frames; i += 1) {
    let sum = 0;
    for (let p = 0; p < frameSize; p += 3) {
      sum += Math.abs(buffer[i * frameSize + p] - buffer[(i - 1) * frameSize + p]);
    }
    deltas[i - 1] = sum / (frameSize / 3);
  }
  const misses: string[] = [];
  for (const cut of bounds.slice(1, -1)) {
    const expected = cut - 1;
    let peakAt = -1;
    let peak = -1;
    for (let f = Math.max(0, cut - 3); f < Math.min(deltas.length, cut + 2); f += 1) {
      if (deltas[f] > peak) { peak = deltas[f]; peakAt = f; }
    }
    if (peakAt !== expected) misses.push(`f${cut} 差值峰在 f${peakAt}`);
  }

  // 白点 R−B 在成片本身上量，不用求解时的估计值
  const wb: (number | null)[] = [];
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const values: number[] = [];
    for (let f = bounds[i]; f < Math.min(bounds[i + 1], frames); f += 1) {
      const base = f * frameSize;
      let sr = 0, sb = 0, n = 0;
      for (let p = 0; p < frameSize; p += 3) {
        const r = buffer[base + p], g = buffer[base + p + 1], b = buffer[base + p + 2];
        if (r >= WHITE && g >= WHITE && b >= WHITE) { sr += r; sb += b; n += 1; }
      }
      if (n >= frameSize / 3 * 0.002) values.push(sr / n - sb / n);
    }
    if (values.length < 3) { wb.push(null); continue; }
    values.sort((a, b) => a - b);
    wb.push(Math.round(values[Math.floor(values.length / 2)] * 10) / 10);
  }
  return { frames, misses, wb };
}

// ---------------------------------------------------------------- 入口

export function parsePostInput(body: unknown): PostInput {
  const input = (body ?? {}) as Record<string, any>;
  const text = (key: string, max = 2000) => {
    const value = input[key];
    assert(typeof value === "string" && value.length > 0 && value.length <= max, 422, `${key} 必须是非空字符串`);
    return value as string;
  };
  const number = (value: unknown, key: string, min: number, max: number, fallback: number) => {
    if (value === undefined || value === null || value === "") return fallback;
    const parsed = Number(value);
    assert(Number.isFinite(parsed) && parsed >= min && parsed <= max, 422, `${key} 超出范围 [${min}, ${max}]`);
    return parsed;
  };

  const segments = Array.isArray(input.segments) ? input.segments : [];
  assert(segments.length > 0 && segments.length <= 24, 422, "segments 需要 1~24 段");
  const parsedSegments: PostSegment[] = segments.map((seg: any, index: number) => {
    const from = Number(seg?.in);
    const to = Number(seg?.out);
    const beats = Number(seg?.beats);
    assert(Number.isFinite(from) && from >= 0, 422, `segments[${index}].in 无效`);
    assert(Number.isFinite(to) && to > from, 422, `segments[${index}].out 必须大于 in`);
    assert(Number.isFinite(beats) && beats > 0 && beats <= 64, 422, `segments[${index}].beats 需要 0~64`);
    return { in: from, out: to, beats };
  });

  const voiceInput = Array.isArray(input.voice) ? input.voice : [];
  const voice: PostVoice[] = voiceInput.map((line: any, index: number) => {
    assert(typeof line?.url === "string" && line.url, 422, `voice[${index}].url 无效`);
    const at = Number(line?.at);
    assert(Number.isFinite(at) && at >= 0, 422, `voice[${index}].at 无效`);
    return { url: line.url, at };
  });

  const beat = input.beat ?? {};
  const bpm = number(beat.bpm, "beat.bpm", 40, 220, 0);
  assert(bpm > 0, 422, "beat.bpm 必填");
  const phase = number(beat.phase, "beat.phase", -1, 2, 0);
  const grade = input.grade ?? {};
  const delivery = input.delivery ?? {};

  return {
    source: text("source"),
    music: text("music"),
    voice,
    segments: parsedSegments,
    beat: { bpm, phase },
    fps: number(input.fps, "fps", 12, 60, 24),
    width: number(input.width, "width", 128, 4096, 1280),
    height: number(input.height, "height", 128, 4096, 720),
    grade: {
      targetRb: number(grade.targetRb, "grade.targetRb", -40, 20, -12),
      contrast: number(grade.contrast, "grade.contrast", 0.5, 2, 1.05),
      saturation: number(grade.saturation, "grade.saturation", 0, 2, 1.04),
    },
    delivery: {
      lufs: number(delivery.lufs, "delivery.lufs", -30, -6, -16),
      dbtp: number(delivery.dbtp, "delivery.dbtp", -6, 0, -1.5),
      crf: number(delivery.crf, "delivery.crf", 0, 32, 12),
    },
    name: typeof input.name === "string" && input.name ? input.name : undefined,
  };
}

export async function renderPost(input: PostInput, dir: string): Promise<Omit<PostReport, "key" | "url">> {
  const source = join(dir, "source");
  const music = join(dir, "music");
  await Promise.all([download(input.source, source), download(input.music, music)]);

  const edl = buildEdl(input.segments, input.beat, input.fps);
  const duration = edl.total / input.fps;
  assert(duration >= 2 && duration <= 600, 422, `成片时长 ${duration.toFixed(2)}s 超出 2~600s`);

  const picture = join(dir, "picture.mp4");
  await renderPicture(source, edl.shots, picture, input.fps, input.width, input.height);

  const graded = join(dir, "graded.mp4");
  const shots = await gradePicture(picture, edl.shots, edl.bounds, input.fps, input.grade, graded);

  const voice = await buildVoiceStem(input.voice, dir, duration);
  const mixed = await mixAudio(
    music, voice.stem, voice.reference, duration, dir, 12.5, 9, input.delivery,
  );

  const master = join(dir, "master.mp4");
  await ff([
    "-i", graded, "-i", mixed,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "libx265", "-crf", String(input.delivery.crf), "-preset", "slow",
    "-pix_fmt", "yuv420p", "-tag:v", "hvc1",
    "-c:a", "aac", "-b:a", "256k", "-ar", String(SR),
    "-movflags", "+faststart", "-t", duration.toFixed(6), master,
  ]);

  const info = await probe(master);
  const loudness = await measureLoudness(master);
  const landing = await cutLanding(master, edl.bounds);
  for (const shot of shots) shot.hiRb = landing.wb[shot.index - 1];

  const judged = landing.wb.filter((value): value is number => value !== null);
  const worst = judged.reduce((max, value) => Math.max(max, Math.abs(value - input.grade.targetRb)), 0);

  const checks = [
    {
      name: "frame_count",
      ok: info.frames === edl.total,
      detail: `${info.frames} / ${edl.total}`,
    },
    {
      name: "loudness",
      ok: loudness.integrated !== null && Math.abs(loudness.integrated - input.delivery.lufs) <= 1,
      detail: `${loudness.integrated ?? "-"} LUFS (目标 ${input.delivery.lufs})`,
    },
    {
      name: "true_peak",
      ok: loudness.truePeak !== null && loudness.truePeak <= input.delivery.dbtp + 0.1,
      detail: `${loudness.truePeak ?? "-"} dBTP (上限 ${input.delivery.dbtp})`,
    },
    {
      name: "cut_landing",
      ok: landing.misses.length === 0,
      detail: landing.misses.length === 0 ? `${edl.bounds.length - 2} 刀全部落帧` : landing.misses.join("; "),
    },
    {
      name: "white_balance",
      ok: judged.length > 0 && worst <= 6,
      detail: judged.length === 0
        ? "没有可判段（白像素不足）"
        : `${judged.length}/${landing.wb.length} 段可判，最大偏 ${worst.toFixed(1)}（目标 ${input.grade.targetRb}）`,
    },
  ];

  const bytes = (await readFile(master)).length;

  return {
    duration: info.duration,
    frames: info.frames,
    bytes,
    loudness,
    voice: { lines: input.voice.length, tiltDb: voice.tilts },
    shots,
    checks,
  };
}

export async function postFilm(input: PostInput): Promise<PostReport> {
  const dir = await mkdtemp(join(tmpdir(), "film-post-"));
  try {
    const report = await renderPost(input, dir);
    const master = join(dir, "master.mp4");
    const buffer = await readFile(master);
    const key = objectKey(input.name ?? `film-post-${randomUUID()}.mp4`);
    await oss().put(key, buffer, { mime: "video/mp4" });
    return { key, url: readUrl(key, 604800), ...report };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
