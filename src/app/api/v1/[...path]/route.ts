import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  authenticate,
  productAccess,
  requireHuman,
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
      return ok({ status: "ok", version: "1.0.0" });
    }
    if (group === "auth" && id === "login" && method === "POST") {
      assert(
        req.headers.get("origin") ===
          new URL(process.env.APP_URL ?? "http://localhost:3000").origin,
        403,
        "登录需要同源请求",
      );
      const data = z
        .object({
          email: z.string().trim().toLowerCase().pipe(z.email()),
          password: z.string().max(200),
        })
        .parse(body);
      const attempts = await db.auditEvent.count({
        where: {
          action: "auth.failed",
          entityId: digest(data.email.toLowerCase()),
          createdAt: { gte: new Date(Date.now() - 15 * 60000) },
        },
      });
      assert(attempts < 10, 429, "登录尝试过多，请稍后重试");
      const user = await db.user.findUnique({
        where: { email: data.email.toLowerCase() },
      });
      if (
        !user?.active ||
        !(await bcrypt.compare(data.password, user.passwordHash))
      ) {
        await db.auditEvent.create({
          data: {
            actorId: "anonymous",
            actorType: "human",
            action: "auth.failed",
            entityId: digest(data.email.toLowerCase()),
            data: {},
          },
        });
        throw new HttpError(401, "邮箱或密码错误");
      }
      const token = randomToken("session_");
      await db.session.create({
        data: {
          hash: digest(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      const res = ok({ id: user.id, name: user.name, role: user.role });
      res.cookies.set("av_session", token, {
        httpOnly: true,
        secure: (process.env.APP_URL ?? "").startsWith("https:"),
        sameSite: "strict",
        path: "/",
        maxAge: 7 * 86400,
      });
      return res;
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
        if (method === "POST") {
          const event = z
            .object({
              type: z.enum([
                "heartbeat",
                "tool",
                "complete",
                "paused",
                "failed",
              ]),
              text: z.string().max(100000).optional(),
              tool: z.string().max(200).optional(),
            })
            .parse(body);
          if (run.stopRequested) return ok({ stopRequested: true });
          if (event.type === "heartbeat")
            await db.agentRun.update({
              where: { id: run.id },
              data: { leaseUntil: new Date(Date.now() + 90000) },
            });
          else if (event.type === "tool")
            await db.auditEvent.create({
              data: {
                actorId: run.id,
                actorType: "agent",
                action: "agent.tool",
                entityId: run.id,
                productId: run.productIds[0],
                data: json({
                  tool: event.tool,
                  text: redact(event.text ?? ""),
                }),
              },
            });
          else
            await db.$transaction(async (tx) => {
              const updated = await tx.agentRun.updateMany({
                where: { id: run.id, status: "running", stopRequested: false },
                data: {
                  status:
                    event.type === "complete"
                      ? "completed"
                      : event.type === "paused"
                        ? "paused"
                        : "failed",
                  result: event.text,
                  error:
                    event.type === "failed" ? String(redact(event.text)) : null,
                  leaseUntil: null,
                },
              });
              if (updated.count && event.text)
                await tx.message.create({
                  data: {
                    conversationId: run.conversationId,
                    role: "assistant",
                    text: String(redact(event.text)),
                  },
                });
            });
          return ok({ ok: true });
        }
      }
      throw new HttpError(404, "内部接口不存在");
    }
    const actor = await authenticate(req);
    const create = (fn: Parameters<typeof idempotent>[3]) =>
      idempotent(
        actor,
        req.headers.get("idempotency-key"),
        { method, path: url.pathname, body },
        fn,
      );
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
          return ok(await context(actor, id));
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
      if (!id && method === "GET") return ok({ items: await listKeys(actor) });
      if (!id && method === "POST")
        return ok(await create((tx) => saveKey(actor, body, tx)), 201);
      if (id && method === "PATCH")
        return ok(await db.$transaction((tx) => saveKey(actor, body, tx, id)));
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
      requireHuman(actor);
      requireScope(actor, "admin");
      if (method === "GET")
        return ok({
          items: await db.user.findMany({
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              active: true,
              createdAt: true,
            },
          }),
        });
      if (method === "POST" && !id) {
        const data = z
          .object({
            email: z.email(),
            name: z.string().min(1),
            password: z.string().min(12),
            role: roleInput,
          })
          .parse(body);
        const passwordHash = await bcrypt.hash(data.password, 12);
        return ok(
          await create(async (tx) => {
            const user = await tx.user.create({
              data: {
                email: data.email.toLowerCase(),
                name: data.name,
                role: data.role,
                passwordHash,
              },
              select: { id: true, email: true, name: true, role: true },
            });
            await audit(tx, actor, "member.created", user.id);
            return user;
          }),
          201,
        );
      }
      if (method === "PATCH" && id) {
        const data = z
          .object({
            name: z.string().min(1).optional(),
            role: roleInput.optional(),
            active: z.boolean().optional(),
          })
          .parse(body);
        assert(
          id !== actor.userId ||
            ((!data.role || data.role === "admin") && data.active !== false),
          422,
          "不能撤销自己的管理员身份",
        );
        return ok(
          await db.$transaction(async (tx) => {
            const u = await tx.user.update({
              where: { id },
              data,
              select: { id: true, name: true, role: true, active: true },
            });
            await audit(tx, actor, "member.updated", id);
            return u;
          }),
        );
      }
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
        const file = await db.fileObject.findUnique({ where: { id } });
        assert(file, 404, "文件不存在");
        productAccess(actor, file.productId);
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
                  productId: file.productId,
                  input: { fileId: id },
                },
              });
              await tx.outbox.create({
                data: { jobId: job.id, phase: "parse" },
              });
              await audit(tx, actor, "file.parse_retried", id, file.productId);
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
        return ok({
          items: await db.fileObject.findMany({
            where: {
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
        productAccess(actor, job.productId);
        if (method === "GET")
          return ok({
            ...job,
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
              await audit(tx, actor, "job.transfer_retried", id, job.productId);
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
            .object({ upstreamId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) })
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
    if (group === "conversations") {
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
        if (method === "POST" && action === "messages")
          return ok(
            await create((tx) => sendMessage(actor, id, body, tx)),
            202,
          );
        if (method === "GET")
          return ok(
            await db.conversation.findUnique({
              where: { id },
              include: {
                messages: { orderBy: { createdAt: "asc" } },
                runs: {
                  select: {
                    id: true,
                    status: true,
                    error: true,
                    result: true,
                    createdAt: true,
                    updatedAt: true,
                  },
                  orderBy: { createdAt: "desc" },
                  take: 10,
                },
              },
            }),
          );
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
            status: { in: ["queued", "submitting", "running", "transferring"] },
          },
        }),
        completedJobs: await db.job.count({
          where: { ...where, status: "succeeded" },
        }),
      });
    }
    throw new HttpError(404, "接口不存在");
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
