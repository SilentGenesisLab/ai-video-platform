import { workerActor } from "../lib/worker-access";
import { meteredCall } from "../lib/metering";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { db } from "../lib/db";
import { oss, persistBuffer } from "../lib/storage";
import { decrypt, redact } from "../lib/security";
import { json } from "../lib/services";
import { providerRequest } from "./provider";
const exec = promisify(execFile);
export async function probeMedia(
  buffer: Buffer,
  mime: string,
): Promise<Record<string, unknown>> {
  if (mime.startsWith("image/")) {
    const m = await sharp(buffer).metadata();
    return { width: m.width, height: m.height };
  }
  if (!mime.startsWith("video/") && !mime.startsWith("audio/")) return {};
  const dir = await mkdtemp(join(tmpdir(), "aivideo-"));
  try {
    const path = join(dir, "input");
    await writeFile(path, buffer);
    const { stdout } = await exec(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
      ],
      { timeout: 60000 },
    );
    const p = JSON.parse(stdout);
    return {
      duration: Number(p.format.duration),
      streams: p.streams.map((s: any) => ({
        type: s.codec_type,
        width: s.width,
        height: s.height,
        codec: s.codec_name,
      })),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function parseFile(fileId: string, jobId: string) {
  const file = await db.fileObject.findUniqueOrThrow({ where: { id: fileId } });
  try {
    const result = await oss().get(file.key),
      buffer = result.content as Buffer;
    let text = "",
      metadata: Record<string, unknown> = {};
    if (file.mime.startsWith("text/")) text = buffer.toString("utf8");
    else if (file.mime === "application/pdf") {
      const parse = (await import("pdf-parse/lib/pdf-parse.js")).default;
      text = (await parse(buffer)).text;
    } else if (file.name.toLowerCase().endsWith(".docx")) {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer })).value;
    } else if (file.mime.startsWith("image/")) {
      const image = await sharp(buffer).metadata();
      metadata = { width: image.width, height: image.height };
      const channel = await db.channel.findFirst({
        where: { provider: "deepseek", enabled: true },
      });
      if (!channel) throw new Error("识图渠道未配置");
      const payload = {
        model: (channel.models as any).vision?.[0] ?? "deepseek-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "请用中文客观描述此产品资料图片，提取可见文字和外观特征。不要编造卖点，把推测与事实区分。",
              },
              {
                type: "image_url",
                image_url: {
                  url:
                    "data:" +
                    file.mime +
                    ";base64," +
                    buffer.toString("base64"),
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
        thinking: { type: "disabled" },
      };
      const response = await meteredCall(
        await workerActor(file.teamId, file.createdBy),
        "parse:" + jobId,
        channel.id,
        "vision",
        payload.model,
        payload,
      );
      text = response.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) throw new Error("识图模型未返回有效文本，请重试解析");
    } else if (
      file.mime.startsWith("video/") ||
      file.mime.startsWith("audio/")
    ) {
      const dir = await mkdtemp(join(tmpdir(), "aivideo-"));
      try {
        const path = join(
          dir,
          "input" + (file.mime.startsWith("video/") ? ".mp4" : ".audio"),
        );
        await writeFile(path, buffer);
        const { stdout } = await exec("ffprobe", [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          path,
        ]);
        const probe = JSON.parse(stdout);
        metadata = {
          duration: Number(probe.format.duration),
          streams: probe.streams.map((s: any) => ({
            type: s.codec_type,
            width: s.width,
            height: s.height,
            codec: s.codec_name,
          })),
        };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      await db.fileObject.update({
        where: { id: fileId },
        data: { metadata: json(metadata) },
      });
      if (
        (metadata.streams as { type: string }[]).some((s) => s.type === "audio")
      ) {
        const channel = await db.channel.findFirst({
          where: { provider: "aicentre", enabled: true },
        });
        if (!channel) throw new Error("转写渠道未配置");
        const model = (channel.models as any).audio?.find((m: string) =>
          m.includes("asr"),
        );
        if (!model) throw new Error("转写型号与采购价尚未配置");
        const speech = await meteredCall(
          await workerActor(file.teamId, file.createdBy),
          "parse:" + jobId,
          channel.id,
          "audio",
          model,
          {
            model,
            file_url: oss().signatureUrl(file.key, { expires: 7200 }),
            language: "auto",
          },
          "/v1/asr/transcriptions",
        );
        text = speech.text ?? "";
      }
    }
    await db.fileObject.update({
      where: { id: fileId },
      data: {
        parseStatus: "completed",
        extractedText: text.slice(0, 500000),
        metadata: json(metadata),
        parseError: null,
      },
    });
  } catch (e) {
    await db.fileObject.update({
      where: { id: fileId },
      data: {
        parseStatus: "failed",
        parseError: String(redact(e instanceof Error ? e.message : String(e))),
      },
    });
    throw e;
  }
}
function escapeXml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
export async function buildOverview(job: {
  id: string;
  productId: string;
  input: unknown;
}) {
  const input = job.input as any,
    shots = [...input.content.shots].sort(
      (a: any, b: any) => a.number - b.number,
    ),
    files = [];
  for (let page = 0; page < Math.max(1, Math.ceil(shots.length / 9)); page++) {
    const cells = shots.slice(page * 9, page * 9 + 9),
      width = 1500,
      cellWidth = 480,
      cellHeight = 320,
      padding = 15,
      composites: sharp.OverlayOptions[] = [];
    for (let index = 0; index < cells.length; index++) {
      const shot = cells[index],
        x = padding + (index % 3) * 495,
        y = padding + Math.floor(index / 3) * 335;
      if (shot.imageFileId) {
        const file = await db.fileObject.findUnique({
          where: { id: shot.imageFileId },
        });
        if (file && file.productId === job.productId) {
          const image = (await oss().get(file.key)).content as Buffer;
          composites.push({
            input: await sharp(image)
              .resize(cellWidth, 270, { fit: "contain", background: "#eef0f5" })
              .png()
              .toBuffer(),
            left: x,
            top: y,
          });
        }
      }
      const label = `<svg width="480" height="50"><rect width="480" height="50" fill="#fff"/><text x="14" y="30" font-size="18" fill="#111827">${escapeXml(String(shot.number).padStart(2, "0") + " · " + shot.duration + "s" + (shot.imageFileId ? "" : " · 待制作"))}</text></svg>`;
      composites.push({ input: Buffer.from(label), left: x, top: y + 270 });
    }
    const image = await sharp({
      create: { width, height: 1020, channels: 3, background: "#e6e9ef" },
    })
      .composite(composites)
      .png()
      .toBuffer();
    files.push(
      await persistBuffer(
        job.productId,
        `storyboard-v${input.version}-${page + 1}.png`,
        "image/png",
        image,
        "worker",
        {
          jobId: job.id,
          resourceId: input.resourceId,
          version: input.version,
          page: page + 1,
        },
      ),
    );
  }
  return {
    files: files.map((f) => ({ fileId: f.id, key: f.key, mime: f.mime })),
    source: { resourceId: input.resourceId, version: input.version },
  };
}
