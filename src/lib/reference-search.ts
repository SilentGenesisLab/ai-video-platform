import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, requireScope, sameOrigin } from "./auth";
import { db, withTeam } from "./db";
import { assert, HttpError } from "./errors";
import { requirePermission } from "./permissions";
import { audit, getResource, idempotent, json } from "./services";
import { fileAccess } from "./access";
import { readUrl } from "./storage";

export async function videoData(path: string, body?: unknown) {
  assert(process.env.VIDEODATA_API_KEY, 503, "参考视频检索服务尚未配置");
  const response = await fetch(
    (process.env.VIDEODATA_BASE_URL || "https://videodata.sligenai.cn") +
      "/api/v1" +
      path,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-API-Key": process.env.VIDEODATA_API_KEY!,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(25000),
      cache: "no-store",
    },
  );
  assert(
    response.ok,
    502,
    "视频检索服务请求失败（HTTP " + response.status + "）",
  );
  return response.json();
}
const inputSchema = z.object({
  imageFileId: z.string().min(1),
  brief: z.string().max(10000).default(""),
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
  targetCount: z.number().int().min(5).max(200).default(30),
  sources: z
    .array(z.string().regex(/^[a-z_]+$/))
    .max(16)
    .optional(),
  videoType: z
    .enum(["tvc", "brand", "ugc", "product", "story", "cg", "case", "review"])
    .default("tvc"),
});

export async function referenceSearchRoute(
  req: NextRequest,
  context: { params: Promise<{ productId: string; jobId?: string }> },
) {
  try {
    const actor = await authenticate(req),
      { productId, jobId } = await context.params;
    if (req.method !== "GET" && actor.type === "human") sameOrigin(req);
    return await withTeam(actor.teamId, async () => {
      requirePermission(actor, "creative.read");
      const product = await getResource(actor, productId);
      assert(product.kind === "product", 404, "产品不存在");
      if (req.method === "POST") {
        requireScope(actor, "write");
        requireScope(actor, "generate");
        requirePermission(actor, "product.write");
        requirePermission(actor, "creative.generate");
        const input = inputSchema.parse(await req.json());
        const file = await fileAccess(actor, input.imageFileId);
        assert(
          file.productId === productId &&
            file.status === "ready" &&
            ["image/jpeg", "image/png", "image/webp"].includes(file.mime) &&
            file.bytes <= 15 * 1024 * 1024,
          422,
          "请选择本产品已上传的 JPG、PNG 或 WebP 图片（不超过15MB）",
        );
        const created: any = await idempotent(
          actor,
          req.headers.get("idempotency-key"),
          { path: req.nextUrl.pathname, input },
          async (tx) => {
            const job = await tx.job.create({
              data: {
                teamId: actor.teamId,
                productId,
                kind: "reference_search",
                status: "awaiting_submit",
                phase: "created",
                input: json({
                  ...input,
                  productVersion: product.version,
                  createdBy: actor.id,
                }),
                actualChannel: "videodata",
              },
            });
            await audit(
              tx,
              actor,
              "reference_search.created",
              job.id,
              productId,
              { productVersion: product.version },
            );
            return job;
          },
        );
        // Claim once before contacting the provider. Ambiguous submission is never automatically repeated.
        const claim = await db.job.updateMany({
          where: { id: created.id, phase: "created" },
          data: { phase: "submitting", status: "searching" },
        });
        if (claim.count) {
          try {
            const upstream = await videoData("/searches", {
              image_url: readUrl(file.key),
              brief: input.brief,
              depth: input.depth,
              target_count: input.targetCount,
              sources: input.sources,
              filters: { types: [input.videoType] },
              download: "none",
              external_id: created.id,
            });
            assert(
              typeof upstream.task_id === "string",
              502,
              "检索服务未返回任务编号",
            );
            await db.job.update({
              where: { id: created.id },
              data: { upstreamId: upstream.task_id, phase: "poll" },
            });
          } catch {
            await db.job.update({
              where: { id: created.id },
              data: {
                status: "needs_confirmation",
                phase: "confirm",
                error: "提交结果未确认，请管理员核实后再决定是否重新检索",
              },
            });
          }
        }
        return NextResponse.json(
          await db.job.findUnique({ where: { id: created.id } }),
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      }
      if (!jobId)
        return NextResponse.json(
          {
            items: await db.job.findMany({
              where: { productId, kind: "reference_search" },
              orderBy: { createdAt: "desc" },
              take: 30,
            }),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      const job = await db.job.findUnique({ where: { id: jobId } });
      assert(
        job?.productId === productId && job.kind === "reference_search",
        404,
        "检索任务不存在",
      );
      if (job.upstreamId) {
        const task = await videoData(
          "/tasks/" + encodeURIComponent(job.upstreamId),
        );
        let run = null;
        if (task.run_id && task.status === "succeeded")
          run = await videoData("/runs/" + encodeURIComponent(task.run_id));
        else if (task.run_id && task.status === "running")
          run = (
            await videoData(
              "/runs/" + encodeURIComponent(task.run_id) + "/partial",
            )
          ).run;
        return NextResponse.json(
          await db.job.update({
            where: { id: job.id },
            data: {
              status:
                task.status === "succeeded"
                  ? "succeeded"
                  : task.status === "failed"
                    ? "failed"
                    : "searching",
              result: json({ task, run }),
              error: task.error
                ? "视频库检索失败，请查看任务进度或重新发起检索"
                : null,
            },
          }),
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json(job, {
        headers: { "Cache-Control": "no-store" },
      });
    });
  } catch (e) {
    const status =
      e instanceof HttpError ? e.status : e instanceof z.ZodError ? 422 : 502;
    return NextResponse.json(
      {
        error: {
          message:
            e instanceof HttpError
              ? e.message
              : status === 422
                ? "检索参数不正确"
                : "参考视频服务暂时不可用",
          code: "REFERENCE_SEARCH_ERROR",
        },
      },
      { status },
    );
  }
}
