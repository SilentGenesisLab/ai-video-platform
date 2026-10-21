import { consentDetails } from "./video-consent";
import { filmConsentItem, filmConfigured } from "./film-pipeline";
import {
  requirePermission,
  permissionsOf,
  hasPermission,
  resourceModule,
} from "./permissions";
import { z } from "zod";
import { db } from "./db";
import { Actor, agentScopes, productAccess, requireScope, roles } from "./auth";
import { audit, getResource, json, Tx } from "./services";
import { assert } from "./errors";
import { decrypt, digest, encrypt, randomToken } from "./security";
import { conversationAccess, fileAccess } from "./access";
export { conversationAccess } from "./access";
import { appendEvent } from "./events";
import { readUrl } from "./storage";
import { prepareAttachments } from "./attachments";
import { canReadBatch } from "./key-authorization";

export async function conversationMedia(actor: Actor, id: string, tx: Tx = db) {
  await conversationAccess(actor, id, tx);
  const runs = await tx.agentRun.findMany({
    where: { conversationId: id },
    select: { id: true },
  });
  const batches = await tx.productionBatch.findMany({
    where: {
      createdBy: { in: runs.map((r) => r.id) },
      ...(actor.productIds.length
        ? { productId: { in: actor.productIds } }
        : {}),
    },
    include: { jobs: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const visible = [];
  for (const b of batches) if (await canReadBatch(actor, b)) visible.push(b);
  const batchItems = await Promise.all(
      visible.map(async (b) => ({
        ...(await consentDetails(actor, b, tx)),
        id: b.id,
        title: b.title,
        kind: b.kind,
        status:
          b.jobs.length && b.jobs.every((j) => j.status === "succeeded")
            ? "succeeded"
            : b.status,
        productId: b.productId,
        count: (b.snapshot as any).entries.length,
        jobs: await Promise.all(
          b.jobs.map(async (j) => ({
            id: j.id,
            status: j.status,
            error: j.error,
            files: await Promise.all(
              (hasPermission(actor, "file.read")
                ? ((j.result as any)?.files ?? [])
                : []
              ).map(async (f: any) => {
                const file = await tx.fileObject.findFirst({
                  where: {
                    id: f.fileId,
                    teamId: actor.teamId,
                    productId: b.productId,
                    status: "ready",
                  },
                });
                return file
                  ? { id: file.id, mime: file.mime, url: readUrl(file.key) }
                  : null;
              }),
            ).then((files) => files.filter(Boolean)),
          })),
        ),
      })),
  );
  const films = filmConfigured()
    ? await Promise.all(
        (
          await tx.job.findMany({
            where: { conversationId: id, kind: "film_pipeline" },
            orderBy: { createdAt: "asc" },
            take: 20,
          })
        ).map((j) => filmConsentItem(actor, j)),
      )
    : [];
  return { items: [...batchItems, ...films] };
}
export async function conversationSnapshot(actor: Actor, id: string) {
  return db.$transaction(async (tx) => {
    await conversationAccess(actor, id, tx);
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${id} FOR UPDATE`;
    const c = await tx.conversation.findUniqueOrThrow({
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
    });
    const last = await tx.agentEvent.findFirst({
      where: { conversationId: id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const searches = await tx.searchRecord.findMany({
      where: { conversationId: id },
      select: { result: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    if (actor.type === "agent")
      c.messages = c.messages.map((m) => ({
        ...m,
        attachmentIds: hasPermission(actor, "file.read") ? m.attachmentIds : [],
        contextRefs: (Array.isArray(m.contextRefs) ? m.contextRefs : []).filter(
          (r: any) =>
            hasPermission(actor, resourceModule(r.kind) + ".read") &&
            (!actor.productIds.length ||
              actor.productIds.includes(r.productId)),
        ),
      }));
    return { ...c, searches, cursor: last?.seq.toString() ?? "0" };
  });
}
export async function createConversation(actor: Actor, input: unknown, tx: Tx) {
  requireScope(actor, "write");
  requirePermission(actor, "chat.execute");
  const data = z
    .object({
      title: z.string().min(1).max(200).default("新对话"),
      productId: z.string().optional(),
      planId: z.string().optional(),
    })
    .parse(input);
  productAccess(actor, data.productId);
  if (data.productId) {
    const p = await getResource(actor, data.productId, tx);
    assert(p.kind === "product", 422, "无效产品");
  }
  if (data.planId) {
    const p = await getResource(actor, data.planId, tx);
    assert(
      p.kind === "plan" && p.productId === data.productId,
      422,
      "无效策划案",
    );
  }
  return tx.conversation.create({ data: { ...data, ownerId: actor.userId } });
}
export async function sendMessage(
  actor: Actor,
  id: string,
  input: unknown,
  tx: Tx,
) {
  requireScope(actor, "write");
  requirePermission(actor, "chat.execute");
  const { text, attachmentIds, referenceIds } = z
    .object({
      text: z.string().max(30000).default(""),
      attachmentIds: z.array(z.string()).max(10).default([]),
      referenceIds: z.array(z.string().uuid()).max(10).default([]),
    })
    .parse(input);
  assert(text.trim() || attachmentIds.length, 422, "请输入内容或添加附件");
  await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${id} FOR UPDATE`;
  const conversation = await conversationAccess(actor, id, tx);
  const active = await tx.agentRun.findFirst({
    where: {
      conversationId: id,
      status: { in: ["queued", "running", "waiting_inputs"] },
    },
  });
  assert(!active, 409, "此会话正在执行，请等待或停止当前任务");
  for (const fileId of attachmentIds) {
    const file = await fileAccess(actor, fileId, tx);
    assert(
      file.conversationId === id ||
        (!!conversation.productId && file.productId === conversation.productId),
      403,
      "附件不属于当前会话或产品",
    );
    assert(file.status === "ready", 409, "附件尚未上传完成");
  }
  const contextRefs = [];
  for (const resourceId of [...new Set(referenceIds)]) {
    const resource = await getResource(actor, resourceId, tx);
    const productId =
      resource.kind === "product" ? resource.id : resource.productId;
    assert(
      !conversation.productId || productId === conversation.productId,
      422,
      "引用与会话产品不匹配，请新建对应产品会话",
    );
    contextRefs.push({
      resourceId,
      version: resource.version,
      title: resource.title,
      kind: resource.kind,
      productId,
      planId: resource.planId,
      content: resource.content,
    });
  }
  const inputJobIds = await prepareAttachments(actor, attachmentIds, text, tx);
  const message = await tx.message.create({
    data: {
      conversationId: id,
      role: "user",
      text,
      attachmentIds,
      contextRefs: json(contextRefs),
    },
  });
  await tx.conversation.update({
    where: { id },
    data: { updatedAt: new Date() },
  });
  const token = randomToken("avr_");
  const run = await tx.agentRun.create({
    data: {
      conversationId: id,
      ownerId: actor.userId,
      sourceKeyId: actor.keyId,
      prompt: text,
      attachmentIds,
      inputJobIds,
      status: inputJobIds.length ? "waiting_inputs" : "queued",
      tokenHash: digest(token),
      tokenCiphertext: encrypt(token),
      scopes: actor.scopes.filter((s) => agentScopes.includes(s)),
      permissions: json(permissionsOf(actor)),
      productScopeMode:
        conversation.productId ||
        actor.productScopeMode === "selected" ||
        actor.productIds.length
          ? "selected"
          : "all",
      productIds: conversation.productId
        ? [conversation.productId]
        : actor.productIds,
    },
  });
  await tx.message.update({
    where: { id: message.id },
    data: { runId: run.id },
  });
  await appendEvent(tx, id, "message", message, run.id);
  await appendEvent(tx, id, "run", { id: run.id, status: run.status }, run.id);
  await audit(tx, actor, "agent.queued", run.id, conversation.productId);
  return { id: run.id, status: run.status, conversationId: id };
}
export async function controlRun(actor: Actor, id: string, action: string) {
  requireScope(actor, "write");
  requirePermission(actor, "chat.control");
  return db.$transaction(async (tx) => {
    const run = await tx.agentRun.findUnique({ where: { id } });
    assert(run, 404, "运行不存在");
    await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${run.conversationId} FOR UPDATE`;
    await conversationAccess(actor, run.conversationId, tx);
    if (action === "stop") {
      await tx.agentRun.update({
        where: { id },
        data: { stopRequested: true, status: "stopped", leaseUntil: null },
      });
    } else {
      assert(
        ["paused", "stopped", "failed"].includes(run.status),
        409,
        "当前运行不能继续",
      );
      assert(
        !(await tx.agentRun.findFirst({
          where: {
            conversationId: run.conversationId,
            status: { in: ["queued", "running", "waiting_inputs"] },
          },
        })),
        409,
        "会话已有运行",
      );
      const token = randomToken("avr_");
      const pendingInputs = await tx.job.count({
        where: {
          id: { in: run.inputJobIds },
          status: { in: ["queued", "running", "submitting"] },
        },
      });
      await tx.agentRun.update({
        where: { id },
        data: {
          status: pendingInputs ? "waiting_inputs" : "queued",
          stopRequested: false,
          leaseUntil: null,
          error: null,
          tokenHash: digest(token),
          tokenCiphertext: encrypt(token),
        },
      });
    }
    if (action === "stop")
      await tx.message.updateMany({
        where: { runId: id, status: "streaming" },
        data: { status: "stopped" },
      });
    await appendEvent(
      tx,
      run.conversationId,
      "run",
      {
        id,
        status: (await tx.agentRun.findUniqueOrThrow({ where: { id } })).status,
      },
      id,
    );
    await audit(tx, actor, "agent." + action, id);
    return { id, action };
  });
}
export async function claimRun() {
  const waiting = await db.agentRun.findMany({
    where: { status: "waiting_inputs", stopRequested: false },
    take: 100,
  });
  for (const w of waiting) {
    const pending = await db.job.count({
      where: {
        id: { in: w.inputJobIds },
        status: { in: ["queued", "running", "submitting"] },
      },
    });
    if (!pending)
      await db.agentRun.updateMany({
        where: { id: w.id, status: "waiting_inputs", stopRequested: false },
        data: { status: "queued" },
      });
  }
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT r.id FROM "AgentRun" r JOIN "Conversation" c ON c.id = r."conversationId" WHERE r."stopRequested" = false AND (r.status = 'queued' OR (r.status = 'running' AND r."leaseUntil" < (NOW() AT TIME ZONE 'UTC'))) ORDER BY r."createdAt" ASC FOR UPDATE OF c SKIP LOCKED LIMIT 1`;
    if (!rows.length) return null;
    // Lock conversation before run, matching stop/event writers. The joined
    // snapshot may predate a heartbeat or claim, so recheck eligibility after
    // acquiring the conversation lock before rotating the execution token.
    const eligible = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "AgentRun" WHERE id = ${rows[0].id} AND "stopRequested" = false AND (status = 'queued' OR (status = 'running' AND "leaseUntil" < (NOW() AT TIME ZONE 'UTC'))) FOR UPDATE`;
    if (!eligible.length) return null;
    const claimedToken = randomToken("avr_");
    const run = await tx.agentRun.update({
      where: { id: rows[0].id },
      data: {
        status: "running",
        attempt: { increment: 1 },
        leaseUntil: new Date(Date.now() + 90000),
        tokenHash: digest(claimedToken),
        tokenCiphertext: encrypt(claimedToken),
      },
      include: {
        conversation: {
          include: { messages: { orderBy: { createdAt: "desc" }, take: 50 } },
        },
      },
    });
    run.conversation.messages.reverse();
    await tx.message.updateMany({
      where: { runId: run.id, status: "streaming" },
      data: { status: "interrupted" },
    });
    await appendEvent(
      tx,
      run.conversationId,
      "run",
      { id: run.id, status: "running", attempt: run.attempt },
      run.id,
    );
    const owner = await tx.user.findUnique({ where: { id: run.ownerId } });
    const membership = await tx.teamMember.findUnique({
      where: { teamId_userId: { teamId: run.teamId, userId: run.ownerId } },
    });
    const team = await tx.team.findUnique({ where: { id: run.teamId } });
    const source = run.sourceKeyId
      ? await tx.apiKey.findUnique({ where: { id: run.sourceKeyId } })
      : null;
    if (
      !owner?.active ||
      !membership?.active ||
      team?.archived ||
      !["owner", "admin", "editor"].includes(membership?.role ?? "") ||
      (run.sourceKeyId &&
        (!source?.enabled ||
          source.teamId !== run.teamId ||
          source.revokedAt ||
          (source.expiresAt && source.expiresAt <= new Date()) ||
          !["read", "write", "generate"].every((scope) =>
            source.scopes.includes(scope),
          ) ||
          !permissionsOf({
            scopes: source.scopes,
            permissions: Array.isArray(source.permissions)
              ? (source.permissions as string[])
              : null,
          }).includes("chat.execute") ||
          (source.productIds.length &&
            (!run.productIds.length ||
              run.productIds.some((p) => !source.productIds.includes(p))))))
    ) {
      await tx.agentRun.update({
        where: { id: run.id },
        data: { status: "failed", error: "所属账号不可用" },
      });
      await appendEvent(
        tx,
        run.conversationId,
        "failed",
        { id: run.id, status: "failed", text: "所属账号或授权已失效" },
        run.id,
      );
      return null;
    }
    const effectivePermissions = permissionsOf({
      scopes: run.scopes,
      permissions: Array.isArray(run.permissions)
        ? (run.permissions as string[])
        : null,
    }).filter(
      (p) =>
        !source ||
        permissionsOf({
          scopes: source.scopes,
          permissions: Array.isArray(source.permissions)
            ? (source.permissions as string[])
            : null,
        }).includes(p),
    );
    const channel = await tx.channel.findFirst({
      where: { provider: "deepseek", enabled: true },
    });
    assert(channel, 503, "DeepSeek 渠道未配置");
    return {
      id: run.id,
      prompt: run.prompt,
      needsTitle:
        run.conversation.messages.filter((m) => m.role === "user")[0]?.runId ===
          run.id &&
        !(await tx.agentEvent.findFirst({
          where: { conversationId: run.conversationId, type: "title" },
        })),
      conversationId: run.conversationId,
      productId: run.conversation.productId,
      planId: run.conversation.planId,
      attempt: run.attempt,
      messages: run.conversation.messages
        .filter((m) => m.status === "completed")
        .map((m) => ({
          ...m,
          attachmentIds: effectivePermissions.includes("file.read")
            ? m.attachmentIds
            : [],
          contextRefs: (Array.isArray(m.contextRefs)
            ? m.contextRefs
            : []
          ).filter(
            (r: any) =>
              effectivePermissions.includes(resourceModule(r.kind) + ".read") &&
              (!run.productIds.length || run.productIds.includes(r.productId)),
          ),
        })),
      attachments: await tx.fileObject.findMany({
        where: {
          teamId: run.teamId,
          id: {
            in: effectivePermissions.includes("file.read")
              ? run.attachmentIds
              : [],
          },
        },
        select: {
          id: true,
          name: true,
          mime: true,
          parseStatus: true,
          parseError: true,
          extractedText: true,
          metadata: true,
        },
      }),
      token: decrypt(run.tokenCiphertext),
      model: {
        channelId: channel.id,
        model: (channel.models as any).text?.[0] ?? "deepseek-flash",
      },
      permissions: effectivePermissions,
      productScopeMode: run.productScopeMode,
      scopes: run.scopes.filter((s) =>
        (roles[membership.role] ?? []).includes(s),
      ),
    };
  });
}
