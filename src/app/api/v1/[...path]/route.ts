import { adminRoute } from "@/lib/platform-admin";
import { meteredStream } from "@/lib/metered-stream";
import { meteredCall } from "@/lib/metering";
import { personalRoute } from "@/lib/personal";
import { billingRoute } from "@/lib/billing";
import { accountRoute } from "@/lib/accounts";
import { teamRoute } from "@/lib/teams";
import { conversationSnapshot } from "@/lib/agent";
import { conversationEvents } from "@/lib/events";
import { recordRunEvent } from "@/lib/run-events";
import { fileAccess, scopedAccess, scopedFilter } from "@/lib/access";
import {
  createAnalysis,
  importVideo,
  saveToProduct,
  readContent,
  retryAnalysis,
} from "@/lib/attachments";
import { webSearch } from "@/lib/search";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db, systemDb, withTeam } from "@/lib/db";
import {
  authenticate,
  productAccess,
  requireHuman,
  requirePlatform,
  requireScope,
  resourceFilter,
} from "@/lib/auth";
import { assert, HttpError } from "@/lib/errors";
import { digest, equalSecret, randomToken, redact } from "@/lib/security";
import {
  audit,
  context,
  getResource,
  idempotent,
  json,
  keyAction,
  listKeys,
  listResources,
  ownedKey,
  resourceDetail,
  saveKey,
  saveResource,
} from "@/lib/services";
import { roleInput, routes } from "@/lib/contracts";
import {
  completeUpload,
  initiateUpload,
  readUrl,
  oss,
  validateMagic,
} from "@/lib/storage";
import { cancelJob, createBatch, decideBatch } from "@/lib/production";
import {
  claimRun,
  controlRun,
  conversationAccess,
  createConversation,
  sendMessage,
} from "@/lib/agent";
import { listChannels, saveChannel } from "@/lib/channels";
import { openapi } from "@/lib/openapi";
import { providerRequest } from "@/worker/provider";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", Vary: "Cookie, Authorization" };
async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const requestId = randomUUID();
  try {
    const parts = (await params).path,
      [group, id, action] = parts,
      method = req.method,
      url = req.nextUrl;
    const multipart = req.headers
      .get("content-type")
      ?.startsWith("multipart/form-data");
    const body =
      ["POST", "PATCH", "PUT"].includes(method) && !multipart
        ? await req.json().catch(() => {
            throw new HttpError(400, "需要合法 JSON 请求体");
          })
        : {};
    const ok = (data: unknown, status = 200) =>
      NextResponse.json(data, {
        status,
        headers: { ...headers, "X-Request-ID": requestId },
      });
    if (group === "openapi.json" && method === "GET") return ok(openapi());
    if (group === "health" && method === "GET") {
      await db.$queryRaw`SELECT 1`;
      return ok({ status: "ok", version: "1.4.0" });
    }
    if (group === "auth") {
      const response = await accountRoute(req, id, body);
      if (response) return response;
    }
    if (group === "internal") {
      assert(
        equalSecret(
          req.headers.get("x-service-secret") ?? "",
          process.env.INTERNAL_SERVICE_SECRET ?? "",
        ),
        401,
        "服务鉴权失败",
      );
      if (id === "metrics" && method === "GET")
        return ok({
          jobs: await db.job.groupBy({ by: ["status"], _count: true }),
          undeliveredEvents: await db.outbox.count({
            where: { deliveredAt: null },
          }),
          oldestPending: await db.outbox.findFirst({
            where: { deliveredAt: null },
            orderBy: { createdAt: "asc" },
            select: { createdAt: true },
          }),
          agentRuns: await db.agentRun.groupBy({
            by: ["status"],
            _count: true,
          }),
        });
      if (id === "agent-model" && method === "POST") {
        const runReq = new NextRequest(req.url, {
          headers: {
            authorization: "Bearer " + req.headers.get("x-run-token"),
          },
        });
        const a = await authenticate(runReq);
        requireScope(a, "generate");
        const d = z
          .object({
            invocationId: z.string().min(1).max(200),
            stream: z.boolean().default(false),
            channelId: z.string(),
            input: z.object({
              model: z.string(),
              messages: z.array(z.any()).max(500),
              tools: z.array(z.any()).optional(),
              max_tokens: z.number().int().positive().max(8192),
            }),
          })
          .parse(body);
        if (d.stream)
          return await withTeam(a.teamId, () =>
            meteredStream(
              a,
              "agent:" + a.id + ":" + d.invocationId,
              d.channelId,
              d.input,
            ),
          );
        return ok(
          await withTeam(a.teamId, () =>
            meteredCall(
              a,
              "agent:" + a.id + ":" + d.invocationId,
              d.channelId,
              "text",
              d.input.model,
              d.input,
            ),
          ),
        );
      }
      if (id === "agent-claim" && method === "POST")
        return ok(await claimRun());
      if (id === "agent-runs" && action) {
        const run = await db.agentRun.findUnique({ where: { id: action } });
        assert(run, 404, "运行不存在");
        assert(
          digest(req.headers.get("x-run-token") ?? "") === run.tokenHash,
          401,
          "此执行实例的租约已失效",
        );
        if (method === "GET")
          return ok({
            id: run.id,
            status: run.status,
            stopRequested: run.stopRequested,
          });
        if (method === "POST")
          return ok(
            await withTeam(run.teamId, () =>
              recordRunEvent(
                action,
                req.headers.get("x-run-token") ?? "",
                body,
              ),
            ),
          );
      }
      throw new HttpError(404, "内部接口不存在");
    }
    const actor = await authenticate(req);
    return await withTeam(actor.teamId, async () => {
      const adminResult = await adminRoute(
        actor,
        parts,
        method,
        body,
        url.searchParams,
      );
      if (adminResult !== undefined) return ok(adminResult);
      const personal = await personalRoute(req, actor, parts, body);
      if (personal !== undefined) return ok(personal);
      const billed = await billingRoute(actor, parts, method, body);
      if (billed !== undefined) return ok(billed);
      if (["teams", "invitations"].includes(group)) {
        const result = await teamRoute(actor, parts, method, body);
        if (result !== undefined) {
          if (method !== "GET")
            await systemDb.auditEvent.create({
              data: {
                teamId: group === "teams" && id ? id : actor.teamId,
                actorId: actor.userId,
                actorType: "human",
                action:
                  "team." + method.toLowerCase() + "." + (action ?? "settings"),
                entityId: group === "invitations" ? undefined : id,
                data: json({
                  operation:
                    group === "invitations" ? "accept" : (action ?? "team"),
                }),
              },
            });
          return ok(result);
        }
      }

      const create = async (fn: Parameters<typeof idempotent>[3]) => {
        // Authorization must run on every request, including idempotent replays.
        if (group === "api-keys") requireHuman(actor);
        else if (group === "channels") requirePlatform(actor);
        else if (["members", "channels"].includes(group)) {
          requireHuman(actor);
          requireScope(actor, "admin");
        } else
          requireScope(
            actor,
            group === "production-batches" || action === "overview"
              ? "generate"
              : "write",
          );
        if (body?.productId) productAccess(actor, body.productId);
        if (body?.conversationId)
          await conversationAccess(actor, body.conversationId);
        const result = await idempotent(
          actor,
          req.headers.get("idempotency-key"),
          { method, path: url.pathname, body },
          fn,
        );
        if (group === "api-keys")
          await ownedKey(actor, (result as { id: string }).id);
        return result;
      };
      if (group === "auth" && id === "me" && method === "GET") return ok(actor);
      if (group === "resources" && id && method === "GET")
        return ok(await resourceDetail(actor, id));
      if (group === "auth" && id === "logout" && method === "POST") {
        const token = req.cookies.get("av_session")?.value;
        if (token)
          await db.session.deleteMany({ where: { hash: digest(token) } });
        const res = ok({ ok: true });
        res.cookies.delete("av_session");
        return res;
      }
      if (routes[group]) {
        const kind = routes[group];
        if (!id && method === "GET")
          return ok(await listResources(actor, kind, url.searchParams));
        if (!id && method === "POST")
          return ok(
            await create((tx) => saveResource(actor, kind, body, tx)),
            201,
          );
        if (id) {
          const r = await getResource(actor, id);
          assert(r.kind === kind, 404, "对象类型不匹配");
          if (method === "GET" && action === "context" && kind === "product")
            return ok(await context(actor, id, url.searchParams));
          if (method === "GET" && !action)
            return ok(await resourceDetail(actor, id));
          if (method === "PATCH" && !action)
            return ok(
              await db.$transaction((tx) =>
                saveResource(actor, kind, body, tx, id),
              ),
            );
          if (
            method === "POST" &&
            action === "overview" &&
            kind === "storyboard"
          ) {
            requireScope(actor, "generate");
            return ok(
              await create(async (tx) => {
                const job = await tx.job.create({
                  data: {
                    kind: "overview",
                    productId: r.productId!,
                    planId: r.planId,
                    input: {
                      resourceId: r.id,
                      version: r.version,
                      content: r.content,
                    },
                  },
                });
                await tx.outbox.create({
                  data: { jobId: job.id, phase: "overview" },
                });
                return job;
              }),
              202,
            );
          }
        }
      }
      if (group === "api-keys") {
        requireHuman(actor);
        if (!id && method === "GET")
          return ok({ items: await listKeys(actor) });
        if (!id && method === "POST")
          return ok(await create((tx) => saveKey(actor, body, tx)), 201);
        if (id && method === "PATCH")
          return ok(
            await db.$transaction((tx) => saveKey(actor, body, tx, id)),
          );
        if (id && method === "DELETE")
          return ok(await keyAction(actor, id, "revoke"));
        if (
          id &&
          method === "POST" &&
          ["rotate", "connection-instructions"].includes(action)
        )
          return ok(await keyAction(actor, id, action));
      }
      if (group === "members") {
        if (method === "GET") {
          const result: any = await teamRoute(
            actor,
            ["teams", actor.teamId, "members"],
            method,
            body,
          );
          return ok({
            items: result.items.map((m: any) => ({
              ...m.user,
              role: m.role,
              active: m.active,
            })),
          });
        }
        throw new HttpError(410, "请通过团队管理发送邀请或调整团队成员");
      }
      if (group === "channels") {
        if (method === "GET") return ok({ items: await listChannels(actor) });
        if (method === "POST" && !id)
          return ok(await create((tx) => saveChannel(actor, body, tx)), 201);
        if (method === "PATCH" && id)
          return ok(
            await db.$transaction((tx) => saveChannel(actor, body, tx, id)),
          );
      }
      if (group === "files") {
        requireScope(actor, "read");
        if (method === "POST" && !id)
          return ok(await create((tx) => initiateUpload(actor, body, tx)), 201);
        if (id) {
          const file = await fileAccess(actor, id);
          if (method === "GET" && action === "content")
            return ok(
              await readContent(
                actor,
                id,
                Number(url.searchParams.get("cursor") ?? 0),
                Number(url.searchParams.get("limit") ?? 8000),
              ),
            );
          if (method === "POST" && action === "analyses")
            return ok(
              await create((tx) =>
                createAnalysis(
                  actor,
                  id,
                  z
                    .object({ prompt: z.string().max(30000).default("") })
                    .parse(body).prompt,
                  tx,
                ),
              ),
              202,
            );
          if (method === "GET" && action === "analyses")
            return ok({
              items: await db.fileAnalysis.findMany({
                where: { fileId: id },
                orderBy: { createdAt: "desc" },
                take: 20,
              }),
            });
          if (method === "POST" && action === "save-to-product")
            return ok(await create((tx) => saveToProduct(actor, id, body, tx)));
          if (method === "POST" && action === "upload") {
            requireScope(actor, "write");
            assert(file.status === "pending", 409, "文件已完成上传");
            const form = await req.formData();
            const value = form.get("file");
            assert(value instanceof File, 422, "缺少 file 文件");
            assert(
              value.size === file.bytes && value.size <= 512 * 1024 * 1024,
              422,
              "文件大小不匹配",
            );
            const buffer = Buffer.from(await value.arrayBuffer());
            validateMagic(buffer, file.mime);
            await oss().put(file.key, buffer, { mime: file.mime });
            return ok({ id: file.id, uploaded: true });
          }
          if (method === "POST" && action === "complete")
            return ok(await completeUpload(actor, id));
          if (method === "POST" && action === "upload-url") {
            requireScope(actor, "write");
            assert(file.status === "pending", 409, "文件已完成上传");
            return ok({
              uploadUrl: oss().signatureUrl(file.key, {
                method: "PUT",
                expires: 900,
                "Content-Type": file.mime,
              }),
              headers: { "Content-Type": file.mime },
            });
          }
          if (
            method === "POST" &&
            action === "retry-parse" &&
            file.mime.startsWith("video/") &&
            (await db.fileAnalysis.count({ where: { fileId: id } }))
          )
            return ok(await create((tx) => retryAnalysis(actor, id, tx)), 202);
          if (method === "POST" && action === "retry-parse") {
            requireScope(actor, "write");
            assert(
              file.status === "ready" && file.parseStatus === "failed",
              409,
              "只有解析失败的文件可重试",
            );
            return ok(
              await db.$transaction(async (tx) => {
                const result = await tx.fileObject.updateMany({
                  where: { id, parseStatus: "failed" },
                  data: { parseStatus: "pending", parseError: null },
                });
                assert(result.count, 409, "解析已重试");
                const job = await tx.job.create({
                  data: {
                    kind: "parse",
                    conversationId: file.conversationId,
                    productId: file.productId,
                    input: { fileId: id },
                  },
                });
                await tx.outbox.create({
                  data: { jobId: job.id, phase: "parse" },
                });
                await audit(
                  tx,
                  actor,
                  "file.parse_retried",
                  id,
                  file.productId,
                );
                return { jobId: job.id };
              }),
              202,
            );
          }
          if (method === "GET")
            return ok({
              ...file,
              url: file.status === "ready" ? readUrl(file.key) : null,
            });
        } else if (method === "GET") {
          const productId = url.searchParams.get("productId");
          if (productId) productAccess(actor, productId);
          const page = Math.max(
            1,
            Math.floor(Number(url.searchParams.get("page")) || 1),
          );
          const limit = Math.min(
            100,
            Math.max(
              1,
              Math.floor(Number(url.searchParams.get("limit")) || 100),
            ),
          );
          const where = {
            ...(await scopedFilter(actor)),
            ...(url.searchParams.get("conversationId")
              ? { conversationId: url.searchParams.get("conversationId")! }
              : {}),
            ...(productId
              ? { productId }
              : actor.productIds.length
                ? { productId: { in: actor.productIds } }
                : {}),
          };
          const [items, total] = await Promise.all([
            db.fileObject.findMany({
              where,
              orderBy: [{ createdAt: "desc" }, { id: "asc" }],
              skip: (page - 1) * limit,
              take: limit,
            }),
            db.fileObject.count({ where }),
          ]);
          return ok({
            items,
            total,
            page,
            limit,
            hasMore: page * limit < total,
          });
        }
      }
      if (group === "production-batches") {
        requireScope(actor, "read");
        if (!id && method === "POST")
          return ok(await create((tx) => createBatch(actor, body, tx)), 201);
        if (id) {
          const batch = await db.productionBatch.findUnique({
            where: { id },
            include: { jobs: true },
          });
          assert(batch, 404, "批次不存在");
          productAccess(actor, batch.productId);
          if (method === "GET") return ok(batch);
        }
        if (!id && method === "GET") {
          const productId = url.searchParams.get("productId");
          if (productId) productAccess(actor, productId);
          return ok({
            items: await db.productionBatch.findMany({
              where: {
                ...(productId
                  ? { productId }
                  : actor.productIds.length
                    ? { productId: { in: actor.productIds } }
                    : {}),
              },
              include: { jobs: true },
              orderBy: { createdAt: "desc" },
              take: 100,
            }),
          });
        }
      }
      if (group === "approvals" && id && method === "POST")
        return ok(await decideBatch(actor, id, body));
      if (group === "jobs") {
        requireScope(actor, "read");
        if (id) {
          const job = await db.job.findUnique({
            where: { id },
            include: { batch: true },
          });
          assert(job, 404, "任务不存在");
          await scopedAccess(actor, job);
          if (method === "GET")
            return ok({
              ...job,
              input: redact(job.input),
              events: await db.auditEvent.findMany({
                where: { entityId: id },
                orderBy: { createdAt: "asc" },
                take: 100,
              }),
            });
          if (method === "POST" && action === "cancel")
            return ok(await cancelJob(actor, id));
          if (method === "POST" && action === "retry-transfer") {
            requireScope(actor, "generate");
            assert(
              job.upstreamId &&
                job.phase === "transfer" &&
                job.status === "transfer_failed",
              409,
              "只能重试转存",
            );
            return ok(
              await db.$transaction(async (tx) => {
                const updated = await tx.job.updateMany({
                  where: { id, status: "transfer_failed" },
                  data: { status: "transferring", error: null },
                });
                assert(updated.count, 409, "任务状态已变化");
                await tx.outbox.create({
                  data: { jobId: id, phase: "transfer" },
                });
                await audit(
                  tx,
                  actor,
                  "job.transfer_retried",
                  id,
                  job.productId,
                );
                return { id };
              }),
            );
          }
          if (method === "POST" && action === "reconcile") {
            requireHuman(actor);
            requireScope(actor, "approve");
            assert(
              job.status === "submission_unknown" &&
                job.channelId &&
                job.providerPath,
              409,
              "只处理提交结果不明的任务",
            );
            const data = z
              .object({
                upstreamId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
              })
              .parse(body);
            const remote = await providerRequest(
              job.channelId,
              job.providerPath + "/" + data.upstreamId,
            );
            const external =
              remote.request?.external_ref ??
              remote.external_ref ??
              remote.request?.metadata?.platform_job_id;
            assert(
              external === job.id,
              422,
              "供应商任务 external_ref 不匹配，不能关联到此任务",
            );
            return ok(
              await db.$transaction(async (tx) => {
                const updated = await tx.job.updateMany({
                  where: { id, status: "submission_unknown" },
                  data: {
                    upstreamId: data.upstreamId,
                    status: "running",
                    phase: "poll",
                    error: null,
                  },
                });
                assert(updated.count, 409, "任务状态已变化");
                await tx.outbox.create({ data: { jobId: id, phase: "poll" } });
                await audit(tx, actor, "job.reconciled", id, job.productId, {
                  upstreamId: data.upstreamId,
                });
                return { id, status: "running" };
              }),
            );
          }
        }
        if (!id && method === "GET") {
          const productId = url.searchParams.get("productId");
          if (productId) productAccess(actor, productId);
          return ok({
            items: await db.job.findMany({
              where: {
                ...(await scopedFilter(actor)),
                ...(productId
                  ? { productId }
                  : actor.productIds.length
                    ? { productId: { in: actor.productIds } }
                    : {}),
              },
              orderBy: { createdAt: "desc" },
              take: 100,
            }),
          });
        }
      }
      if (group === "tools" && id === "web-search" && method === "POST")
        return ok(
          await webSearch(actor, body, req.headers.get("idempotency-key")),
        );
      if (group === "conversations") {
        requireScope(actor, "read");
        if (!id && method === "POST")
          return ok(
            await create((tx) => createConversation(actor, body, tx)),
            201,
          );
        if (!id && method === "GET")
          return ok({
            items: await db.conversation.findMany({
              where: {
                ownerId: actor.userId,
                ...(actor.productIds.length
                  ? { productId: { in: actor.productIds } }
                  : {}),
              },
              orderBy: { updatedAt: "desc" },
              take: 50,
            }),
          });
        if (id) {
          await conversationAccess(actor, id);
          if (method === "GET" && action === "events")
            return await conversationEvents(req, id);
          if (method === "POST" && action === "imports")
            return ok(
              await create((tx) => importVideo(actor, id, body, tx)),
              202,
            );
          if (method === "POST" && action === "messages")
            return ok(
              await create((tx) => sendMessage(actor, id, body, tx)),
              202,
            );
          if (method === "GET")
            return ok(await conversationSnapshot(actor, id));
        }
      }
      if (
        group === "agent-runs" &&
        id &&
        method === "POST" &&
        ["stop", "continue"].includes(action)
      )
        return ok(await controlRun(actor, id, action));
      if (group === "audit-events" && method === "GET") {
        requireScope(actor, "read");
        const productId = url.searchParams.get("productId");
        if (productId) productAccess(actor, productId);
        return ok({
          items: await db.auditEvent.findMany({
            where: {
              ...(productId
                ? { productId }
                : actor.productIds.length
                  ? { productId: { in: actor.productIds } }
                  : {}),
              ...(actor.type === "agent" ? { actorId: actor.id } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
        });
      }
      if (group === "dashboard" && method === "GET") {
        requireScope(actor, "read");
        const items = await db.resource.groupBy({
          by: ["kind"],
          where: { ...resourceFilter(actor), status: { not: "archived" } },
          _count: true,
        });
        const where = actor.productIds.length
          ? { productId: { in: actor.productIds } }
          : {};
        return ok({
          counts: Object.fromEntries(items.map((i) => [i.kind, i._count])),
          pendingApprovals: await db.productionBatch.count({
            where: { ...where, status: "pending_approval" },
          }),
          runningJobs: await db.job.count({
            where: {
              ...where,
              status: {
                in: ["queued", "submitting", "running", "transferring"],
              },
            },
          }),
          completedJobs: await db.job.count({
            where: { ...where, status: "succeeded" },
          }),
        });
      }
      throw new HttpError(404, "接口不存在");
    });
  } catch (e) {
    const status =
      e instanceof HttpError ? e.status : e instanceof z.ZodError ? 422 : 500;
    const message =
      e instanceof z.ZodError
        ? e.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")
        : e instanceof HttpError
          ? e.message
          : "服务暂时不可用";
    if (status === 500)
      console.error(
        JSON.stringify({
          requestId,
          error: redact(e instanceof Error ? e.message : String(e)),
        }),
      );
    return NextResponse.json(
      {
        error: {
          code:
            e instanceof HttpError
              ? e.code
              : status === 422
                ? "VALIDATION_ERROR"
                : "INTERNAL_ERROR",
          message,
          requestId,
        },
      },
      { status, headers },
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
