import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "../lib/db";
import { decrypt } from "../lib/security";
import { json } from "../lib/services";
import { oss, objectKey } from "../lib/storage";
import { assert } from "../lib/errors";
import { withPublicVideo } from "./public-video";
const exec = promisify(execFile);
export async function importVideoFile(jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const input = job.input as any;
  await withPublicVideo(
    decrypt(input.urlCiphertext),
    async (path, name, mime, bytes) => {
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
      const probe = JSON.parse(stdout);
      assert(
        probe.streams.some((s: any) => s.codec_type === "video"),
        422,
        "链接内容不是有效视频",
      );
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      const key = objectKey(name);
      await oss().put(key, path, { mime });
      await db.$transaction(async (tx) => {
        const fresh = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
        if (fresh.status === "succeeded") return;
        const file = await tx.fileObject.create({
          data: {
            conversationId: job.conversationId,
            name,
            mime,
            bytes,
            key,
            sha256: hash.digest("hex"),
            status: "ready",
            parseStatus: "deferred",
            metadata: json({
              duration: Number(probe.format.duration),
              source: "video_link",
            }),
            createdBy: input.ownerId,
          },
        });
        await tx.job.update({
          where: { id: jobId },
          data: {
            status: "succeeded",
            phase: "done",
            result: { fileId: file.id },
          },
        });
      });
    },
  );
}
