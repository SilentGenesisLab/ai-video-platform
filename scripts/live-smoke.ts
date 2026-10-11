import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { decrypt } from "../src/lib/security";
import { oss } from "../src/lib/storage";
const base = process.env.APP_URL!;
let cookie = "";
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
  if (!r.ok) throw new Error(`${path}: ${r.status} ${data.error?.message}`);
  if (path === "/auth/login")
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  return data;
}
async function main() {
  await api("/auth/login", "POST", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  await mkdir(".runtime", { recursive: true });
  let state: any = {};
  try {
    state = JSON.parse(await readFile(".runtime/live-smoke.json", "utf8"));
  } catch {}
  const save = () =>
    writeFile(".runtime/live-smoke.json", JSON.stringify(state, null, 2));
  if (!state.product) {
    const product = await api("/products", "POST", {
      title: "验收样例 · 极简桌面灯",
      content: {
        description: "用于平台端到端验收的虚构产品，仅演示制作流程。",
        sellingPoints: ["蓝色圆柱灯体的视觉概念"],
        audience: "视觉设计团队",
        brief:
          "测试用桌面灯，未定义商业性能参数。请勿添加真实功效、认证或销量。",
      },
    });
    state.product = product.id;
    await save();
  }
  const channel = (await api("/channels")).items.find(
    (c: any) => c.provider === "aicentre",
  );
  if (!state.plan) {
    state.plan = (
      await api("/plans", "POST", {
        title: "桌面一束光 · 验收策划案",
        productId: state.product,
        content: {
          objective: "验证从产品到生成结果的追溯链",
          message: "光照亮桌面",
          visualStyle: "极简、自然光、干净背景",
          duration: 5,
          aspectRatio: "16:9",
        },
      })
    ).id;
    await save();
  }
  if (!state.board) {
    state.board = (
      await api("/storyboards", "POST", {
        title: "桌面一束光 · 工业分镜",
        productId: state.product,
        planId: state.plan,
        content: {
          shots: [
            {
              id: "hero",
              number: 1,
              duration: 5,
              description: "淡蓝色圆柱台灯位于简洁桌面，自然光从侧面进入。",
              framing: "近景",
              movement: "缓慢推近",
            },
          ],
        },
      })
    ).id;
    await save();
  }
  if (!state.imageBatch) {
    state.imageBatch = (
      await api("/production-batches", "POST", {
        title: "真实验收 · 单张分镜图",
        productId: state.product,
        planId: state.plan,
        kind: "image",
        entries: [
          {
            channelId: channel.id,
            model: "gpt-image-2.5",
            prompt:
              "Minimal studio product photograph of a small matte pastel blue cylindrical desk lamp on a clean beige desk. Soft natural side light, neutral warm background, no text, no logos, no people. Wide 16:9 composition.",
            targetResourceId: state.board,
            targetShotId: "hero",
            parameters: { image_size: "1K", aspect_ratio: "16:9" },
          },
        ],
      })
    ).id;
    await save();
  }
  if (!state.audioBatch) {
    state.audioBatch = (
      await api("/production-batches", "POST", {
        title: "真实验收 · 背景音乐",
        productId: state.product,
        planId: state.plan,
        kind: "audio",
        entries: [
          {
            channelId: channel.id,
            model: "suno-v6",
            prompt:
              "Soft minimal ambient background instrumental for a quiet desk lamp product film. Gentle piano, calm warm atmosphere, no vocals.",
            parameters: { instrumental: true, title: "Quiet Light" },
          },
        ],
      })
    ).id;
    await save();
  }
  if (!state.conversation) {
    state.conversation = (
      await api("/conversations", "POST", {
        title: "真实验收 · Agent 创意写入",
        productId: state.product,
        planId: state.plan,
      })
    ).id;
    await save();
    const run = await api(
      "/conversations/" + state.conversation + "/messages",
      "POST",
      {
        text: "请读取当前产品资料，并为这个虚构桌面灯创建一个创意批次和 2 条不同的创意。保存到平台，包含 hook、idea、structure、emotion、selfReview。不生成任何付费媒体。保存后告诉我各对象 ID。",
      },
    );
    state.agentRun = run.id;
    await save();
  }
  const image = await api("/production-batches/" + state.imageBatch),
    audio = await api("/production-batches/" + state.audioBatch),
    chat = await api("/conversations/" + state.conversation);
  if (image.jobs[0]?.status === "transfer_failed")
    await api("/jobs/" + image.jobs[0].id + "/retry-transfer", "POST", {});
  if (
    image.jobs[0]?.status === "failed" &&
    !state.imageRetry &&
    process.env.RETRY_IMAGE === "1"
  ) {
    state.failedImageBatch = state.imageBatch;
    state.imageRetry = true;
    state.imageBatch = (
      await api("/production-batches", "POST", {
        title: "真实验收 · 图片新一轮尝试",
        productId: state.product,
        planId: state.plan,
        kind: "image",
        entries: [
          {
            channelId: channel.id,
            model: "gpt-image-2.5",
            prompt:
              "A blue desk lamp on a beige table, minimal product photograph, soft daylight, no text.",
            targetResourceId: state.board,
            targetShotId: "hero",
            parameters: { image_size: "1K", aspect_ratio: "16:9" },
          },
        ],
      })
    ).id;
    await save();
  }
  if (audio.jobs[0]?.status === "transfer_failed") {
    await api("/jobs/" + audio.jobs[0].id + "/retry-transfer", "POST", {});
  }
  if (image.jobs[0]?.status === "succeeded" && !state.imageFile) {
    state.imageFile = image.jobs[0].result.files[0].fileId;
    await save();
    const product = await api("/products/" + state.product);
    await api("/products/" + state.product, "PATCH", {
      title: product.title,
      baseVersion: product.version,
      content: {
        ...product.content,
        coverFileId: state.imageFile,
        fileIds: [...product.content.fileIds, state.imageFile],
      },
    });
    const board = await api("/storyboards/" + state.board);
    await api("/storyboards/" + state.board, "PATCH", {
      title: board.title,
      productId: board.productId,
      planId: board.planId,
      baseVersion: board.version,
      content: {
        shots: board.content.shots.map((s: any) => ({
          ...s,
          imageFileId: state.imageFile,
        })),
      },
    });
    state.overview = (
      await api("/storyboards/" + state.board + "/overview", "POST", {})
    ).id;
    await save();
  }
  if (state.imageFile && !state.videoBatch) {
    state.videoBatch = (
      await api("/production-batches", "POST", {
        title: "待人工确认 · 真实视频验收（4秒）",
        productId: state.product,
        planId: state.plan,
        kind: "video",
        entries: [
          {
            channelId: channel.id,
            model: "seedance-2.5",
            prompt:
              "保持参考图片中的桌面灯、颜色和场景完全一致。摄影机极缓慢推近，柔和自然光保持稳定，安静的产品特写。无人物、无文字、无标志。不改变产品形状。",
            referenceFileIds: [state.imageFile],
            sources: [{ resourceId: state.board, version: 2 }],
            parameters: {
              duration_seconds: 4,
              resolution: "480p",
              aspect_ratio: "16:9",
              sound: false,
            },
          },
        ],
      })
    ).id;
    await save();
  }
  if (state.imageFile && !state.vision) {
    const file = await db.fileObject.findUniqueOrThrow({
      where: { id: state.imageFile },
    });
    const c = await db.channel.findFirstOrThrow({
      where: { provider: "deepseek" },
    });
    const r = await fetch(c.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + decrypt(c.ciphertext),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "用一句中文描述画面中的产品和主要颜色，不要推测功能。",
              },
              {
                type: "image_url",
                image_url: {
                  url: oss().signatureUrl(file.key, { expires: 3600 }),
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
        thinking: { type: "disabled" },
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (r.ok) {
      state.vision = (await r.json()).choices[0].message.content;
      await save();
    } else console.log("Vision HTTP " + r.status);
  }
  console.log(
    JSON.stringify(
      {
        productId: state.product,
        image: image.jobs.map((j: any) => ({
          id: j.id,
          status: j.status,
          error: j.error,
        })),
        audio: audio.jobs.map((j: any) => ({
          id: j.id,
          status: j.status,
          error: j.error,
        })),
        agent: chat.runs.map((r: any) => ({
          id: r.id,
          status: r.status,
          error: r.error,
        })),
        vision: state.vision,
        overview: state.overview,
        videoBatch: state.videoBatch,
      },
      null,
      2,
    ),
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
