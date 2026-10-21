import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { assert } from "./errors";
import { objectKey, oss, readUrl } from "./storage";

/**
 * 把生成式模型产出的分段 + 配乐合成一条成片。**不依赖任何外部内核**，
 * 只要求运行环境有 ffmpeg/ffprobe（本仓库镜像已装）。
 *
 * 生成式模型的片段规格不保证一致——帧率、分辨率、有无音轨都可能不同——
 * 所以每段先归一化再拼接，不能直接 `-c copy` 拼原始素材。
 */

const exec = promisify(execFile);
const FFMPEG_TIMEOUT = 15 * 60 * 1000;
const SEGMENT_FPS = 24;

export type AssembleInput = {
  segments: string[];
  music?: string | null;
  targetLufs?: number | null;
  limitDbtp?: number | null;
  fadeOutSec?: number | null;
  name?: string;
};

export type AssembleResult = {
  key: string;
  url: string;
  duration: number;
  bytes: number;
};

type MediaInfo = {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

async function probe(path: string): Promise<MediaInfo> {
  const { stdout } = await exec(
    "ffprobe",
    [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      path,
    ],
    { timeout: 60000, maxBuffer: 8 << 20 },
  );
  const parsed = JSON.parse(stdout);
  const video = (parsed.streams ?? []).find((s: any) => s.codec_type === "video");
  return {
    duration: Number(parsed.format?.duration ?? video?.duration ?? 0),
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    hasAudio: (parsed.streams ?? []).some((s: any) => s.codec_type === "audio"),
  };
}

async function download(url: string, path: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  assert(response.ok, 502, `素材下载失败 HTTP ${response.status}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
}

/** 统一帧率/像素格式/声道，缺音轨时补静音——否则拼接会因流不匹配直接失败。 */
async function normalize(
  source: string,
  target: string,
  info: MediaInfo,
  width: number,
  height: number,
) {
  const duration = info.duration > 0 ? info.duration : 0;
  const args = [
    "-y",
    "-fflags", "+genpts",
    ...(duration > 0 ? ["-t", duration.toFixed(3)] : []),
    "-i", source,
  ];
  if (!info.hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
  args.push("-map", "0:v:0", "-map", info.hasAudio ? "0:a:0" : "1:a:0");
  if (width > 0 && height > 0) {
    args.push(
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
    );
  }
  args.push(
    "-r", String(SEGMENT_FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-shortest", "-movflags", "+faststart",
    target,
  );
  await exec("ffmpeg", args, { timeout: FFMPEG_TIMEOUT, maxBuffer: 16 << 20 });
}

function loudnormReport(stderr: string) {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stderr.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 单遍 loudnorm 在短素材上会偏 1~2 LU，所以先测一遍再按测量值线性归一。
 *  测量必须带上最终会生效的前置滤镜（裁切 + 淡出），否则测的和实际处理的不是同一段音频。 */
async function measureLoudness(
  audio: string,
  duration: number,
  targetLufs: number,
  peak: number,
  prefix: string[],
) {
  const args = [
    "-hide_banner",
    "-nostdin",
    "-t", duration.toFixed(3),
    "-i", audio,
    "-af",
    [...prefix, `loudnorm=I=${targetLufs}:TP=${peak}:LRA=11:print_format=json`].join(","),
    "-f", "null",
    "-",
  ];
  try {
    const { stderr } = await exec("ffmpeg", args, {
      timeout: FFMPEG_TIMEOUT,
      maxBuffer: 32 << 20,
    });
    return loudnormReport(stderr);
  } catch (error: any) {
    return loudnormReport(String(error?.stderr ?? ""));
  }
}

async function concat(
  dir: string,
  files: string[],
  target: string,
) {
  const list = join(dir, "concat.txt");
  const escape = (p: string) => p.replaceAll("'", "'\\''");
  await writeFile(list, files.map((f) => `file '${escape(f)}'`).join("\n"));
  // 各段已归一化成同一套编码参数，这里可以直接 copy，不二次损失画质。
  await exec(
    "ffmpeg",
    [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", list,
      "-c", "copy",
      "-movflags", "+faststart",
      target,
    ],
    { timeout: FFMPEG_TIMEOUT, maxBuffer: 16 << 20 },
  );
}

async function muxMusic(
  video: string,
  music: string,
  target: string,
  duration: number,
  targetLufs: number | null,
  limitDbtp: number | null,
  fadeOutSec: number | null,
) {
  const prefix = [`atrim=0:${duration.toFixed(3)}`, "asetpts=PTS-STARTPTS"];
  if (fadeOutSec && fadeOutSec > 0 && duration > 0) {
    const start = Math.max(0, duration - fadeOutSec);
    prefix.push(
      `afade=t=out:st=${start.toFixed(3)}:d=${fadeOutSec.toFixed(3)}`,
    );
  }
  const filters = [...prefix];
  if (targetLufs !== null) {
    const peak = limitDbtp ?? -1.5;
    const report = await measureLoudness(music, duration, targetLufs, peak, prefix);
    if (report) {
      filters.push(
        `loudnorm=I=${targetLufs}:TP=${peak}:LRA=11` +
          `:measured_I=${report.input_i}:measured_TP=${report.input_tp}` +
          `:measured_LRA=${report.input_lra}:measured_thresh=${report.input_thresh}` +
          `:offset=${report.target_offset ?? "0"}:linear=true`,
      );
    } else {
      filters.push(`loudnorm=I=${targetLufs}:TP=${peak}:LRA=11`);
    }
    filters.push(
      "aresample=192000",
      `alimiter=limit=${peak}dB:level=disabled`,
      "aresample=44100",
    );
  }
  filters.push("apad");
  await exec(
    "ffmpeg",
    [
      "-y",
      "-i", video,
      "-i", music,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-af", filters.join(","),
      "-c:a", "aac",
      "-ar", "44100",
      "-ac", "2",
      "-shortest",
      "-movflags", "+faststart",
      target,
    ],
    { timeout: FFMPEG_TIMEOUT, maxBuffer: 32 << 20 },
  );
}

export function parseAssembleInput(body: unknown): AssembleInput {
  const input = (body ?? {}) as Record<string, unknown>;
  const segments = Array.isArray(input.segments)
    ? input.segments.filter((s): s is string => typeof s === "string" && s.length > 0)
    : [];
  assert(segments.length > 0, 422, "segments 至少要有一段");
  assert(segments.length <= 20, 422, "segments 最多 20 段");
  const number = (key: string, min: number, max: number) => {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === "") return null;
    const value = Number(raw);
    assert(
      Number.isFinite(value) && value >= min && value <= max,
      422,
      `${key} 超出范围 [${min}, ${max}]`,
    );
    return value;
  };
  return {
    segments,
    music: typeof input.music === "string" && input.music ? input.music : null,
    targetLufs: number("targetLufs", -40, -5),
    limitDbtp: number("limitDbtp", -6, 0),
    fadeOutSec: number("fadeOutSec", 0, 10),
    name: typeof input.name === "string" && input.name ? input.name : undefined,
  };
}

export async function assembleFilm(input: AssembleInput): Promise<AssembleResult> {
  const dir = await mkdtemp(join(tmpdir(), "film-assemble-"));
  try {
    const sources: string[] = [];
    for (const [index, url] of input.segments.entries()) {
      const path = join(dir, `source_${index}.mp4`);
      await download(url, path);
      sources.push(path);
    }

    const infos = await Promise.all(sources.map(probe));
    const width = infos[0].width;
    const height = infos[0].height;
    assert(width > 0 && height > 0, 502, "首段没有视频流，无法合成");

    const normalized: string[] = [];
    for (const [index, source] of sources.entries()) {
      const target = join(dir, `norm_${index}.mp4`);
      await normalize(source, target, infos[index], width, height);
      normalized.push(target);
    }

    const joined =
      normalized.length === 1 ? normalized[0] : join(dir, "joined.mp4");
    await concat(dir, normalized, joined);

    let finalPath = joined;
    if (input.music) {
      const musicPath = join(dir, "music");
      await download(input.music, musicPath);
      finalPath = join(dir, "film.mp4");
      const joinedInfo = await probe(joined);
      const duration = joinedInfo.duration > 0 ? joinedInfo.duration : 0;
      assert(duration > 0, 502, "拼接后的成片没有可用时长");
      await muxMusic(
        joined,
        musicPath,
        finalPath,
        duration,
        input.targetLufs ?? null,
        input.limitDbtp ?? null,
        input.fadeOutSec ?? null,
      );
    }

    const buffer = await readFile(finalPath);
    const key = objectKey(input.name ?? `film-${randomUUID()}.mp4`);
    await oss().put(key, buffer, { mime: "video/mp4" });
    const info = await probe(finalPath);
    return {
      key,
      url: readUrl(key, 604800),
      duration: info.duration,
      bytes: buffer.length,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
