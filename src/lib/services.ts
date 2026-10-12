import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import {
  Actor,
  agentScopes,
  productAccess,
  requireHuman,
  requireScope,
  resourceFilter,
  roles,
} from "./auth";
import { assert, HttpError } from "./errors";
import {
  canonical,
  decrypt,
  digest,
  encrypt,
  randomToken,
  redact,
} from "./security";
import {
  contentSchemas,
  keyInput,
  Kind,
  resourceInput,
  sourceSchema,
} from "./contracts";
export type Tx = Prisma.TransactionClient;
export const json = (x: unknown) =>
  JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue;
export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityId?: string,
  productId?: string | null,
  data: unknown = {},
) {
  return tx.auditEvent.create({
    data: {
      actorId: actor.id,
      actorType: actor.type,
      action,
      entityId,
      productId,
      data: json(redact(data)),
    },
  });
}
export async function idempotent(
  actor: Actor,
  key: string | null,
  request: unknown,
  fn: (tx: Tx) => Promise<unknown>,
) {
  assert(
    key && key.length >= 8 && key.length <= 200,
    400,
    "创建操作必须提供 8–200 字符 Idempotency-Key",
  );
  const requestHash = digest(canonical(request)),
    where = { teamId_actorId_key: { teamId: actor.teamId, actorId: actor.id, key } };
  const previous = await db.idempotency.findUnique({ where });
  const replay = (response: any) => {
    if (response?.kind === "product") productAccess(actor, response.id);
    else if (response?.productId) productAccess(actor, response.productId);
    return response;
  };
  if (previous) {
    assert(previous.requestHash === requestHash, 409, "相同幂等键对应不同请求");
    return replay(previous.response);
  }
  try {
    return await db.$transaction(
      async (tx) => {
        const record = await tx.idempotency.create({
          data: { teamId: actor.teamId, actorId: actor.id, key, requestHash },
        });
        const result = await fn(tx);
        await tx.idempotency.update({
          where: { id: record.id },
          data: { response: json(result) },
        });
        return result;
      },
      { timeout: 20000 },
    );
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const existing = await db.idempotency.findUnique({ where });
      if (existing) {
        assert(existing.requestHash === requestHash, 409, "幂等键冲突");
        return replay(existing.response);
      }
      throw new HttpError(409, "该对象已存在");
    }
    throw e;
  }
}
export async function getResource(actor: Actor, id: string, tx: Tx = db) {
  requireScope(actor, "read");
  const r = await tx.resource.findUnique({ where: { id } });
  assert(r && r.teamId === actor.teamId, 404, "对象不存在");
  productAccess(actor, r.kind === "product" ? r.id : r.productId);
  return r;
}
export async function checkedSources(
  actor: Actor,
  sources: z.infer<typeof sourceSchema>[],
  productId: string,
  tx: Tx = db,
) {
  const unique = new Map<string, z.infer<typeof sourceSchema>>();
  for (const s of sources) {
    const r = await getResource(actor, s.resourceId, tx);
    assert(
      r.kind === "product" ? r.id === productId : r.productId === productId,
      422,
      "来源必须属于同一产品",
    );
    const rev = await tx.revision.findUnique({
      where: {
        resourceId_version: { resourceId: s.resourceId, version: s.version },
      },
    });
    assert(rev, 422, "引用版本不存在");
    unique.set(s.resourceId + ":" + s.version, s);
  }
  return [...unique.values()];
}
export function fileReferences(value: unknown): string[] {
  const refs: string[] = [];
  function visit(x: unknown) {
    if (!x || typeof x !== "object") return;
    for (const [k, v] of Object.entries(x)) {
      if (/FileIds$|^fileIds$/.test(k) && Array.isArray(v))
        refs.push(...v.filter((s): s is string => typeof s === "string"));
      else if (/FileId$|^fileId$/.test(k) && typeof v === "string")
        refs.push(v);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (typeof v === "object") visit(v);
    }
  }
  visit(value);
  return [...new Set(refs.filter(Boolean))];
}
export async function validateFiles(
  actor: Actor,
  ids: string[],
  productId: string,
  tx: Tx = db,
) {
  productAccess(actor, productId);
  const files = await tx.fileObject.findMany({ where: { id: { in: ids } } });
  assert(
    files.length === new Set(ids).size &&
      files.every((f) => f.productId === productId && f.status === "ready"),
    422,
    "引用文件不存在、未完成上传或不属于此产品",
  );
  return files;
}
function nestedSources(content: any): z.infer<typeof sourceSchema>[] {
  return [
    ...(content.assets ?? []),
    ...(content.shots ?? []).flatMap((s: any) => s.assets ?? []),
  ];
}
export async function saveResource(
  actor: Actor,
  kind: Kind,
  input: unknown,
  tx: Tx,
  id?: string,
) {
  requireScope(actor, "write");
  const parsed = resourceInput.parse(input),
    content = contentSchemas[kind].parse(parsed.content) as any;
  const old = id ? await getResource(actor, id, tx) : null;
  if (old) assert(old.kind === kind, 404, "类型不匹配");
  if (old)
    assert(
      parsed.baseVersion === old.version,
      409,
      "内容已更新，请读取最新版本再修改",
      "VERSION_CONFLICT",
    );
  const productId = old?.productId ?? parsed.productId;
  if (kind === "product") {
    productAccess(actor, id);
    assert(
      !parsed.productId && !parsed.planId && !parsed.parentId,
      422,
      "产品不能关联父级",
    );
  } else {
    assert(productId, 422, "需要 productId");
    const product = await getResource(actor, productId, tx);
    assert(product.kind === "product", 422, "无效产品");
    if (old)
      assert(
        !parsed.productId || parsed.productId === old.productId,
        422,
        "不能移动对象到其他产品",
      );
  }
  const planId = old?.planId ?? parsed.planId,
    parentId = old?.parentId ?? parsed.parentId;
  const previous =
    old && !Object.hasOwn(input as object, "sources")
      ? await tx.revision.findUnique({
          where: {
            resourceId_version: { resourceId: old.id, version: old.version },
          },
        })
      : null;
  const explicit = nestedSources(content);
  const sources = [
    ...(
      (previous?.sources ?? parsed.sources) as z.infer<typeof sourceSchema>[]
    ).filter((s) => !explicit.some((e) => e.resourceId === s.resourceId)),
    ...explicit,
  ];
  if (productId) {
    const product = await getResource(actor, productId, tx);
    if (!sources.some((s) => s.resourceId === product.id))
      sources.push({ resourceId: product.id, version: product.version });
  }
  if (planId) {
    const plan = await getResource(actor, planId, tx);
    assert(
      plan.kind === "plan" && plan.productId === productId,
      422,
      "策划案与产品不匹配",
    );
    if (!sources.some((s) => s.resourceId === plan.id))
      sources.push({ resourceId: plan.id, version: plan.version });
  }
  if (parentId) {
    const parent = await getResource(actor, parentId, tx);
    assert(parent.productId === productId, 422, "父级产品不匹配");
    assert(
      (kind === "concept" && parent.kind === "creative-batch") ||
        (kind === "plan" && parent.kind === "concept"),
      422,
      "无效父级类型",
    );
    if (!sources.some((s) => s.resourceId === parent.id))
      sources.push({ resourceId: parent.id, version: parent.version });
  }
  if (["storyboard", "script"].includes(kind))
    assert(planId, 422, "分镜和制作脚本必须属于策划案");
  if (old) {
    assert(
      !parsed.planId || parsed.planId === old.planId,
      422,
      "不能更换策划案",
    );
    assert(
      !parsed.parentId || parsed.parentId === old.parentId,
      422,
      "不能更换父级",
    );
  }
  const fileIds = fileReferences(content);
  const checkedFiles = fileIds.length
    ? await validateFiles(
        actor,
        fileIds,
        kind === "product" ? (id ?? "") : productId!,
        tx,
      )
    : [];
  if (kind === "deliverable")
    assert(
      checkedFiles
        .find((f) => f.id === content.fileId)
        ?.mime.startsWith("video/"),
      422,
      "成片必须引用视频文件",
    );
  const imageIds =
    kind === "storyboard"
      ? content.shots.flatMap((s: any) =>
          [s.imageFileId, ...s.candidateFileIds].filter(Boolean),
        )
      : kind === "product" && content.coverFileId
        ? [content.coverFileId]
        : [];
  assert(
    imageIds.every((id: string) =>
      checkedFiles.find((f) => f.id === id)?.mime.startsWith("image/"),
    ),
    422,
    "封面和分镜图必须引用图片文件",
  );
  for (const source of nestedSources(content)) {
    const asset = await getResource(actor, source.resourceId, tx);
    assert(asset.kind === "asset", 422, "资产引用必须指向资产的具体版本");
  }
  if (kind === "deliverable") {
    const jobs = await tx.job.findMany({
      where: { id: { in: content.sourceJobIds } },
    });
    assert(
      jobs.length === new Set(content.sourceJobIds).size &&
        jobs.every(
          (j) =>
            j.productId === productId &&
            j.status === "succeeded" &&
            j.kind === "video",
        ),
      422,
      "成片来源任务无效",
    );
  }
  if (kind === "script" && content.shotIds.length) {
    const board = await tx.resource.findUnique({
      where: { uniqueSlot: "storyboard:" + planId },
    });
    assert(board, 422, "需要先创建分镜");
    const boardVersion =
      sources.find((s) => s.resourceId === board.id)?.version ?? board.version;
    const revision = await tx.revision.findUnique({
      where: {
        resourceId_version: { resourceId: board.id, version: boardVersion },
      },
    });
    assert(revision, 422, "引用的分镜版本不存在");
    const shotIds = new Set(
      (revision.content as any).shots.map((s: any) => s.id),
    );
    assert(
      content.shotIds.every((s: string) => shotIds.has(s)),
      422,
      "镜头不存在",
    );
    if (!sources.some((s) => s.resourceId === board.id))
      sources.push({ resourceId: board.id, version: boardVersion });
  }
  const finalSources = productId
    ? await checkedSources(actor, sources, productId, tx)
    : [];
  const data = {
    title: parsed.title,
    status: parsed.status,
    content: json(content),
    updatedBy: actor.id,
  };
  let resource;
  if (old) {
    const result = await tx.resource.updateMany({
      where: { id: old.id, version: parsed.baseVersion },
      data: { ...data, version: { increment: 1 } },
    });
    assert(result.count === 1, 409, "版本冲突", "VERSION_CONFLICT");
    resource = await tx.resource.findUniqueOrThrow({ where: { id: old.id } });
  } else
    resource = await tx.resource.create({
      data: {
        ...data,
        kind,
        productId,
        planId,
        parentId,
        uniqueSlot: kind === "storyboard" ? "storyboard:" + planId : undefined,
        createdBy: actor.id,
      },
    });
  await tx.revision.create({
    data: {
      resourceId: resource.id,
      version: resource.version,
      title: resource.title,
      status: resource.status,
      content: resource.content as Prisma.InputJsonValue,
      sources: json(finalSources),
      actorId: actor.id,
      actorType: actor.type,
    },
  });
  await audit(
    tx,
    actor,
    old ? "resource.revised" : "resource.created",
    resource.id,
    kind === "product" ? resource.id : productId,
    { kind, version: resource.version },
  );
  return resource;
}
export async function listResources(
  actor: Actor,
  kind: Kind,
  params: URLSearchParams,
) {
  requireScope(actor, "read");
  if (params.get("productId")) productAccess(actor, params.get("productId"));
  const page = Math.max(1, Number(params.get("page")) || 1),
    limit = Math.min(100, Math.max(1, Number(params.get("limit")) || 30));
  const where: Prisma.ResourceWhereInput = {
    kind,
    status: params.get("status") || { not: "archived" },
    ...resourceFilter(actor),
    ...(params.get("productId") ? { productId: params.get("productId")! } : {}),
    ...(params.get("planId") ? { planId: params.get("planId")! } : {}),
    ...(params.get("parentId") ? { parentId: params.get("parentId")! } : {}),
    ...(params.get("q")
      ? { title: { contains: params.get("q")!, mode: "insensitive" } }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.resource.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.resource.count({ where }),
  ]);
  return { items, total, page, limit };
}
export async function resourceDetail(actor: Actor, id: string) {
  const resource = await getResource(actor, id);
  const revisions = await db.revision.findMany({
    where: { resourceId: id },
    orderBy: { version: "desc" },
  });
  const sourceRefs = (revisions[0]?.sources ?? []) as z.infer<
    typeof sourceSchema
  >[];
  const latest = await db.resource.findMany({
    where: { id: { in: sourceRefs.map((s) => s.resourceId) } },
  });
  const staleSources = sourceRefs.filter(
    (s) => latest.find((r) => r.id === s.resourceId)?.version !== s.version,
  );
  return { ...resource, revisions, staleSources };
}
export async function context(actor: Actor, id: string) {
  const product = await getResource(actor, id);
  assert(product.kind === "product", 422, "需要产品 ID");
  const resources = await db.resource.findMany({
    where: { productId: id },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const files = await db.fileObject.findMany({
    where: { productId: id, status: "ready" },
    select: {
      id: true,
      name: true,
      mime: true,
      parseStatus: true,
      extractedText: true,
      parseError: true,
    },
    take: 100,
  });
  return { product, resources, files };
}
const keySelect = {
  id: true,
  name: true,
  note: true,
  prefix: true,
  ownerId: true,
  scopes: true,
  productIds: true,
  enabled: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
export async function listKeys(actor: Actor) {
  requireHuman(actor);
  return db.apiKey.findMany({
    where: {
      revokedAt: null,
      ...(actor.role === "admin" ? {} : { ownerId: actor.userId }),
    },
    select: keySelect,
    orderBy: { createdAt: "desc" },
  });
}
export async function ownedKey(actor: Actor, id: string, tx: Tx = db) {
  requireHuman(actor);
  const key = await tx.apiKey.findUnique({ where: { id } });
  assert(key && !key.revokedAt, 404, "Key 不存在");
  assert(
    actor.role === "admin" || key.ownerId === actor.userId,
    403,
    "只能管理自己的 Key",
  );
  return key;
}
export async function saveKey(
  actor: Actor,
  input: unknown,
  tx: Tx,
  id?: string,
) {
  requireHuman(actor);
  const data = keyInput.parse(input);
  const old = id ? await ownedKey(actor, id, tx) : null;
  const ownerId = old?.ownerId ?? data.ownerId ?? actor.userId;
  assert(
    actor.role === "admin" || ownerId === actor.userId,
    403,
    "不能为其他成员创建 Key",
  );
  const owner = await tx.user.findUnique({ where: { id: ownerId } });
  const membership = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: actor.teamId, userId: ownerId } } });
  assert(owner?.active && membership?.active, 422, "成员不可用");
  assert(
    data.scopes.every(
      (s) =>
        actor.scopes.includes(s) &&
        (roles[membership!.role] ?? []).includes(s) &&
        agentScopes.includes(s),
    ),
    403,
    "不能授予超出成员权限的能力",
  );
  for (const productId of data.productIds) {
    const r = await getResource(actor, productId, tx);
    assert(r.kind === "product", 422, "无效产品范围");
  }
  const token = randomToken();
  const fields = {
    name: data.name,
    note: data.note,
    scopes: data.scopes,
    productIds: data.productIds,
    enabled: data.enabled,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
  };
  const key = old
    ? await tx.apiKey.update({
        where: { id: old.id },
        data: fields,
        select: keySelect,
      })
    : await tx.apiKey.create({
        data: {
          ...fields,
          ownerId,
          prefix: token.slice(0, 12),
          hash: digest(token),
          ciphertext: encrypt(token),
        },
        select: keySelect,
      });
  await audit(tx, actor, old ? "key.updated" : "key.created", key.id);
  return key;
}
export async function keyAction(actor: Actor, id: string, action: string) {
  return db.$transaction(async (tx) => {
    const key = await ownedKey(actor, id, tx);
    if (action === "revoke") {
      await tx.apiKey.update({
        where: { id },
        data: { enabled: false, revokedAt: new Date(), ciphertext: "" },
      });
      await audit(tx, actor, "key.revoked", id);
      return { id, revoked: true };
    }
    if (action === "rotate") {
      const token = randomToken();
      const result = await tx.apiKey.update({
        where: { id },
        data: {
          prefix: token.slice(0, 12),
          hash: digest(token),
          ciphertext: encrypt(token),
        },
        select: keySelect,
      });
      await audit(tx, actor, "key.rotated", id);
      return result;
    }
    assert(
      key.enabled && (!key.expiresAt || key.expiresAt > new Date()),
      409,
      "此 Key 已禁用或过期",
    );
    const owner = await tx.user.findUnique({ where: { id: key.ownerId } });
    assert(owner?.active, 409, "Key 所属成员已停用");
    const base = (process.env.APP_URL ?? "http://localhost:3000").replace(
      /\/$/,
      "",
    );
    await audit(tx, actor, "key.instructions_copied", id);
    return {
      instructions: `请安装并使用 AI Video Platform Skill（版本 1.1.0）。\n平台：${base}\n安装入口：${base}/skills/ai-video-platform/SKILL.md\n安装包：${base}/skills/ai-video-platform.zip\n\n将以下配置保存到你环境的私有凭据配置中，不打印或提交到仓库：\nAIVIDEO_BASE_URL=${base}\nAIVIDEO_API_KEY=${decrypt(key.ciphertext)}\n\n先读取安装入口，安装到当前 Agent 支持的 Skill 目录。使用 GET /api/v1/auth/me 验证身份与权限；验证阶段不要创建数据或调用生成。后续按我的具体任务操作平台。\n权限：${key.scopes.join(", ")}\n固定团队：${actor.teamName} (${actor.teamId})\n产品范围：${key.productIds.length ? key.productIds.join(", ") : "全部产品"}\n视频生成必须在平台人工审批。`,
      skillVersion: "1.1.0",
    };
  });
}
