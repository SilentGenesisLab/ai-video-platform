import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assert } from "../lib/errors";
export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function withPublicVideo<T>(
  url: string,
  use: (file: string, name: string, mime: string, bytes: number) => Promise<T>,
) {
  let current = new URL(url);
  const directory = await mkdtemp(join(tmpdir(), "aivideo-import-"));
  try {
    for (let hop = 0; hop < 4; hop++) {
      assert(
        current.protocol === "https:" &&
          !current.username &&
          !current.password &&
          (!current.port || current.port === "443"),
        422,
        "需要公网 HTTPS 视频直链",
      );
      const host = current.hostname.replace(/^\[|\]$/g, "");
      const addresses = await lookup(host, { all: true });
      assert(
        addresses.length && addresses.every((a) => isPublicAddress(a.address)),
        422,
        "视频链接不能访问私有或保留地址",
      );
      const target = addresses[0];
      const dispatcher = new Agent({
        connect: {
          lookup: ((_hostname: string, options: any, callback: any) =>
            options?.all
              ? callback(null, [target])
              : callback(null, target.address, target.family)) as any,
        },
      });
      try {
        const response = await request(current, {
          dispatcher,
          method: "GET",
          signal: AbortSignal.timeout(180000),
          headersTimeout: 30000,
          bodyTimeout: 30000,
        });
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.body.destroy();
          assert(response.headers.location, 422, "视频链接跳转无效");
          current = new URL(String(response.headers.location), current);
          continue;
        }
        assert(
          response.statusCode === 200,
          422,
          `视频下载失败 HTTP ${response.statusCode}`,
        );
        const mime = String(response.headers["content-type"] ?? "")
          .split(";")[0]
          .trim();
        assert(
          ["video/mp4", "video/webm", "video/quicktime"].includes(mime),
          422,
          "链接必须直接返回 MP4、WebM 或 MOV 视频文件",
        );
        assert(
          Number(response.headers["content-length"] ?? 0) <= 512 * 1024 * 1024,
          413,
          "视频超过 512 MB",
        );
        let bytes = 0;
        const file = join(directory, "video");
        const limit = new Transform({
          transform(chunk, _encoding, callback) {
            bytes += chunk.length;
            callback(
              bytes > 512 * 1024 * 1024 ? new Error("视频超过 512 MB") : null,
              chunk,
            );
          },
        });
        await pipeline(response.body, limit, createWriteStream(file));
        let name = "参考视频.mp4";
        try {
          name = decodeURIComponent(
            current.pathname.split("/").pop() || name,
          ).slice(-150);
        } catch {}
        return await use(file, name, mime, bytes);
      } finally {
        await dispatcher.destroy();
      }
    }
    throw new Error("视频链接跳转次数过多");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
