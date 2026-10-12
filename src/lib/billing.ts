import { scheduleSchema, priceMultiplier } from "./price-schedule";
import { deepseekOfficialPrice } from "./official-prices";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, systemDb, withTeam } from "./db";
import { Actor, requirePlatform, requireScope } from "./auth";
import { assert } from "./errors";
import { lockPersonal, payerUser } from "./personal-credits";
import { canonical, digest } from "./security";
import { json, Tx, getResource } from "./services";
import { batchInput } from "./contracts";
const D = Prisma.Decimal;
export const points = (cost: Prisma.Decimal.Value) =>
  new D(cost).mul(100).toDecimalPlaces(6, D.ROUND_UP);
export const batchDigest = (input: any) => {
  const { quoteId, ...rest } = batchInput.parse(input) as any;
  return digest(canonical(rest));
};
export async function saveRate(a: Actor, input: any) {
  requirePlatform(a);
  const data = z
    .object({
      channelId: z.string(),
      model: z.string().min(1),
      kind: z.enum([
        "text",
        "vision",
        "image",
        "video",
        "audio",
        "video_understanding",
        "search",
      ]),
      unit: z.enum(["token", "image", "second", "request"]),
      rate: z.coerce.number().positive(),
      inputRate: z.coerce.number().nonnegative().optional(),
      cachedInputRate: z.coerce.number().nonnegative().optional(),
      resolution: z.string().default(""),
      supplier: z.string().default(""),
      pricingParameters: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .default({}),
      basis: z.string().min(1).max(1000),
      billingSchedule: scheduleSchema.optional(),
      sourceUrl: z.url().optional(),
      checkedAt: z.coerce.date().optional(),
    })
    .parse(input);
  const channel = await db.channel.findUnique({
    where: { id: data.channelId },
  });
  assert(
    channel && (channel.models as any)[data.kind]?.includes(data.model),
    422,
    "渠道或型号无效",
  );
  assert(
    data.unit !== "token" ||
      (data.inputRate !== undefined && data.cachedInputRate !== undefined),
    422,
    "Token 采购价需包含输入、缓存命中和输出每百万 Token 价格",
  );
  assert(
    !["text", "vision"].includes(data.kind) || data.unit === "token",
    422,
    "文本与识图使用 Token 计费",
  );
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"price:" + data.channelId + data.model}))`;
    const last = await tx.purchaseRate.findFirst({
      where: {
        channelId: data.channelId,
        model: data.model,
        resolution: data.resolution,
        supplier: data.supplier,
      },
      orderBy: { version: "desc" },
    });
    const r = await tx.purchaseRate.create({
      data: {
        ...data,
        billingSchedule: json(data.billingSchedule ?? {}),
        pricingParameters: json(data.pricingParameters),
        version: (last?.version ?? 0) + 1,
        createdBy: a.userId,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: a.userId,
        actorType: "human",
        action: "platform.price_created",
        entityId: r.id,
        data: { model: r.model, version: r.version, basis: r.basis },
      },
    });
    return r;
  });
}
export async function rateLine(
  channelId: string,
  model: string,
  kind: string,
  parameters: any = {},
  tokenInput?: any,
  priceTx?: Tx,
) {
  const resolution = String(
    parameters.resolution ??
      parameters.image_size ??
      (kind === "video" ? "720p" : kind === "image" ? "1K" : ""),
  );
  const all = await db.purchaseRate.findMany({
    where: {
      channelId,
      model,
      kind,
      resolution: { in: ["", resolution] },
      effectiveAt: { lte: new Date() },
    },
    orderBy: { version: "desc" },
  });
  // The empty supplier rule is the administrator's contractual ceiling for automatic routing.
  const matches = all.filter((r) =>
    Object.entries(r.pricingParameters as Record<string, unknown>).every(
      ([k, v]) => parameters[k] === v,
    ),
  );
  matches.sort(
    (a, b) =>
      Object.keys(b.pricingParameters as object).length -
        Object.keys(a.pricingParameters as object).length ||
      Number(b.resolution === resolution) -
        Number(a.resolution === resolution) ||
      b.version - a.version,
  );
  let rate = matches.find(
    (r) => r.supplier === "" && r.sourceType !== "estimated",
  );
  if (!rate) {
    const setting = await systemDb.platformSetting.findUnique({
      where: { id: "main" },
    });
    const fallback = setting?.fallbackCny ?? new D(1);
    rate = matches.find(
      (r) =>
        r.supplier === "" &&
        r.sourceType === "estimated" &&
        r.rate.eq(fallback),
    );
    if (!rate) {
      const createFallback = async (tx: Tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"price:" + channelId + model}))`;
        const existing = await tx.purchaseRate.findFirst({
          where: {
            channelId,
            model,
            kind,
            supplier: "",
            resolution: "",
            sourceType: "estimated",
            rate: fallback,
          },
          orderBy: { version: "desc" },
        });
        if (existing) return existing;
        const last = await tx.purchaseRate.findFirst({
          where: { channelId, model, supplier: "", resolution: "" },
          orderBy: { version: "desc" },
        });
        return tx.purchaseRate.create({
          data: {
            channelId,
            model,
            kind,
            unit: "request",
            rate: fallback,
            version: (last?.version ?? 0) + 1,
            basis: "临时估算：默认每次请求收费",
            sourceType: "estimated",
            createdBy: "system",
          },
        });
      };
      rate = priceTx
        ? await createFallback(priceTx)
        : await systemDb.$transaction(createFallback);
    }
  }
  let units = 1,
    cost = new D(rate.rate);
  if (rate.unit === "second") {
    units = Number(parameters.duration_seconds ?? parameters.duration ?? 5);
    cost = cost.mul(units);
  }
  if (rate.unit === "image") {
    units = Number(parameters.n ?? 1);
    cost = cost.mul(units);
  }
  if (rate.unit === "token") {
    assert(tokenInput, 422, "缺少模型调用输入");
    const maxOutput = Math.min(Number(tokenInput.max_tokens ?? 8192), 8192);
    // UTF-8 bytes bound text token counts; image payloads reserve a full vision context.
    const serialized =
      JSON.stringify(tokenInput.messages ?? []) +
      JSON.stringify(tokenInput.tools ?? []);
    const inputTokens =
      kind === "video_understanding" || serialized.includes("image_url")
        ? 1000000
        : Buffer.byteLength(serialized, "utf8") + 4096;
    assert(inputTokens <= 1000000, 422, "输入上下文过长");
    units = inputTokens;
    cost = D.max(rate.inputRate ?? 0, rate.cachedInputRate ?? 0)
      .mul(inputTokens)
      .add(new D(rate.rate).mul(maxOutput))
      .div(1000000);
  }
  assert(Number.isFinite(units) && units > 0, 422, "无效计费数量");
  return {
    submittedAt: new Date().toISOString(),
    billingSchedule: rate.billingSchedule,
    sourceType: rate.sourceType,
    rateId: rate.id,
    channelId,
    model,
    kind,
    unit: rate.unit,
    units,
    parameters,
    costCny: cost.toString(),
    creditPolicy: "media-only-v1",
    billable: kind === "image" || kind === "video",
    amount:
      kind === "image" || kind === "video" ? points(cost).toString() : "0",
    version: rate.version,
    basis: rate.basis,
    resolution,
  };
}
export async function quoteBatch(a: Actor, input: any) {
  requireScope(a, "generate");
  const data = batchInput.parse(input);
  await getResource(a, data.productId);
  if (data.planId) {
    const plan = await getResource(a, data.planId);
    assert(plan.productId === data.productId, 422, "策划案归属不匹配");
  }
  const { validateEntry } = await import("./production");
  const lines = [];
  for (const entry of data.entries) {
    const normalized = await validateEntry(
      a,
      data.kind,
      entry,
      data.productId,
      data.planId,
      db,
    );
    lines.push(
      await rateLine(
        entry.channelId,
        entry.model,
        data.kind,
        normalized.parameters,
      ),
    );
  }
  const amount = lines.reduce((v, l) => v.add(l.amount), new D(0));
  return db.creditQuote.create({
    data: {
      teamId: a.teamId,
      actorId: a.userId,
      digest: batchDigest(data),
      input: json(data),
      lines: json(lines),
      amount,
      expiresAt: new Date(Date.now() + 10 * 60000),
    },
  });
}
export async function validateQuoteRates(tx: Tx, lines: any) {
  for (const line of lines) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"price:" + line.channelId + line.model}))`;
    const current = await rateLine(
      line.channelId,
      line.model,
      line.kind,
      line.parameters,
      undefined,
      tx,
    );
    assert(
      current.rateId === line.rateId,
      409,
      "采购价已变化，请重新报价并确认审批",
    );
  }
}
export async function lockWallet(tx: Tx, teamId: string) {
  await tx.$executeRaw`SELECT id FROM "Wallet" WHERE "teamId"=${teamId} FOR UPDATE`;
  const w = await tx.wallet.findUniqueOrThrow({ where: { teamId } });
  const t = await tx.team.findUnique({ where: { id: teamId } });
  assert(t && !t.archived, 409, "团队已归档");
  return w;
}
export async function reserveUsage(
  tx: Tx,
  a: { teamId: string; userId: string },
  invocationId: string,
  line: any,
  requestHash: string,
) {
  const userId = await payerUser(tx, a.userId, a.teamId);
  const w = await lockPersonal(tx, userId),
    old = await tx.usageRecord.findUnique({ where: { invocationId } });
  if (old) {
    assert(
      old.payerKind !== "user" || old.payerUserId === userId,
      403,
      "调用不属于当前付款人",
    );
    assert(old.requestHash === requestHash, 409, "同一调用标识不能更改输入");
    return old;
  }
  const amount = new D(line.amount);
  assert(
    amount.greaterThanOrEqualTo(0) && w.balance.sub(w.frozen).gte(amount),
    402,
    "个人可用积分不足",
    "INSUFFICIENT_CREDITS",
  );
  const record = await tx.usageRecord.create({
    data: {
      teamId: a.teamId,
      invocationId,
      actorId: userId,
      payerKind: "user",
      payerUserId: userId,
      kind: line.kind,
      model: line.model,
      channelId: line.channelId,
      rateId: line.rateId,
      quoteLine: json(line),
      requestHash,
      reserved: amount,
    },
  });
  await tx.userWallet.update({
    where: { id: w.id },
    data: { frozen: { increment: amount } },
  });
  await tx.personalCreditLedger.create({
    data: {
      userId,
      sourceTeamId: a.teamId,
      eventKey: "reserve:" + record.id,
      actorId: a.userId,
      kind: "reserve",
      amount,
      referenceId: record.id,
      reason: "生成前冻结积分",
    },
  });
  return record;
}
export async function settleUsage(
  id: string,
  cost: Prisma.Decimal.Value | null,
  type = "calculated",
  data: any = {},
) {
  const found = await systemDb.usageRecord.findUniqueOrThrow({ where: { id } });
  return withTeam(found.teamId, () =>
    db.$transaction(async (tx) => {
      const personal = found.payerKind === "user";
      const w = personal
          ? await lockPersonal(tx, found.payerUserId!)
          : await lockWallet(tx, found.teamId),
        u = await tx.usageRecord.findUniqueOrThrow({ where: { id } });
      if (["settled", "released"].includes(u.status)) return u;
      if (cost === null)
        return tx.usageRecord.update({
          where: { id },
          data: {
            status: "reconcile",
            costType: "unknown",
            data: json(data),
            error: "费用待对账；积分保持冻结",
          },
        });
      const c = new D(cost);
      assert(c.gte(0), 422, "费用不能为负数");
      // Legacy reservations retain their original charging policy.
      const line = u.quoteLine as any;
      const free = line.creditPolicy === "media-only-v1" && !line.billable;
      const amount = free ? new D(0) : points(c);
      if (w.balance.sub(w.frozen).add(u.reserved).lt(amount))
        return tx.usageRecord.update({
          where: { id },
          data: {
            status: "reconcile",
            costCny: c,
            error: "实际费用超过冻结额，待补充积分后对账",
            data: json(data),
          },
        });
      const walletData = {
        balance: { decrement: amount },
        frozen: { decrement: u.reserved },
      };
      if (personal)
        await tx.userWallet.update({ where: { id: w.id }, data: walletData });
      else await tx.wallet.update({ where: { id: w.id }, data: walletData });
      const ledgerData = {
        eventKey: "settle:" + id,
        actorId: u.actorId,
        kind: amount.eq(0) ? "release" : "charge",
        amount: amount.neg(),
        referenceId: id,
        reason: amount.eq(0)
          ? free && c.gt(0)
            ? "AI 交互免费，供应商成本单独记录"
            : "确认未产生费用，释放冻结"
          : type === "actual"
            ? "按供应商账单结算"
            : type === "estimated"
              ? "临时估算结算"
              : type === "manual"
                ? "平台管理员对账"
                : "按人民币采购价计算",
      };
      if (personal)
        await tx.personalCreditLedger.create({
          data: {
            ...ledgerData,
            userId: found.payerUserId!,
            sourceTeamId: found.teamId,
          },
        });
      else
        await tx.creditLedger.create({
          data: { ...ledgerData, teamId: found.teamId },
        });
      return tx.usageRecord.update({
        where: { id },
        data: {
          status: c.eq(0) ? "released" : "settled",
          charged: amount,
          costCny: c,
          costType: type,
          data: json(data),
          error: null,
        },
      });
    }),
  );
}
export async function usageFromResult(
  id: string,
  result: any,
  successful: boolean,
) {
  const u = await db.usageRecord.findUniqueOrThrow({ where: { id } }),
    line = u.quoteLine as any;
  const actual =
    result.billed_cost_cny ??
    (result.currency === "CNY" ? result.billed_cost : undefined) ??
    (result.billing?.currency === "CNY" ? result.billing?.cost : undefined);
  if (actual !== undefined)
    return settleUsage(id, actual, "actual", {
      upstream: result.id ?? result.job_id,
    });
  if (!successful) return settleUsage(id, null);
  let r = await db.purchaseRate.findUniqueOrThrow({ where: { id: u.rateId } });
  if (r.sourceType === "estimated")
    return settleUsage(id, r.rate, "estimated", {
      rateId: r.id,
      basis: r.basis,
    });
  const supplier = result.channel ?? result.actual_channel;
  if (supplier) {
    await db.usageRecord.update({
      where: { id },
      data: { actualSupplier: String(supplier) },
    });
    const specificRates = await db.purchaseRate.findMany({
      where: {
        channelId: u.channelId,
        model: u.model,
        kind: u.kind,
        resolution: { in: ["", line.resolution] },
        supplier: String(supplier),
        effectiveAt: { lte: u.createdAt },
      },
      orderBy: [{ resolution: "desc" }, { version: "desc" }],
    });
    // A generic contract must explicitly cover routing; otherwise only the actual supplier price can settle.
    const matched = specificRates.filter((rate) =>
      Object.entries(rate.pricingParameters as Record<string, unknown>).every(
        ([k, v]) => line.parameters?.[k] === v,
      ),
    );
    matched.sort(
      (a, b) =>
        Object.keys(b.pricingParameters as object).length -
          Object.keys(a.pricingParameters as object).length ||
        Number(b.resolution === line.resolution) -
          Number(a.resolution === line.resolution) ||
        b.version - a.version,
    );
    if (matched[0]) r = matched[0];
  }
  if (r.unit === "token") {
    const raw = result.usage;
    const usage = raw
      ? {
          ...raw,
          prompt_tokens: raw.prompt_tokens ?? raw.input_tokens,
          completion_tokens: raw.completion_tokens ?? raw.output_tokens,
          prompt_tokens_details:
            raw.prompt_tokens_details ?? raw.input_tokens_details,
        }
      : undefined;
    if (
      !usage ||
      !Number.isFinite(usage.prompt_tokens) ||
      !Number.isFinite(usage.completion_tokens)
    )
      return settleUsage(id, null);
    const cached = Math.min(
      usage.prompt_tokens,
      usage.prompt_cache_hit_tokens ??
        usage.prompt_tokens_details?.cached_tokens ??
        0,
    );
    const cost = new D(r.inputRate ?? 0)
      .mul(usage.prompt_tokens - cached)
      .add(new D(r.cachedInputRate ?? r.inputRate ?? 0).mul(cached))
      .add(new D(r.rate).mul(usage.completion_tokens))
      .div(1000000);
    const multiplier = priceMultiplier(r.billingSchedule, u.createdAt);
    return settleUsage(id, cost.mul(multiplier), "calculated", {
      usage,
      rateId: r.id,
      multiplier,
    });
  }
  return settleUsage(
    id,
    new D(r.rate).mul(r.unit === "request" ? 1 : line.units),
    "calculated",
    { rateId: r.id, supplier: supplier ?? null },
  );
}
export async function billingRoute(
  a: Actor,
  parts: string[],
  method: string,
  body: any,
) {
  const [group, id, action] = parts;
  if (group === "billing") {
    requireScope(a, "read");
    if (id === "wallet" && method === "GET")
      return systemDb.userWallet.upsert({
        where: { userId: a.userId },
        create: { userId: a.userId },
        update: {},
      });
    if (id === "usage" && method === "GET")
      return {
        items: await systemDb.usageRecord.findMany({
          where: {
            payerUserId: a.userId,
            ...(a.type === "agent" ? { teamId: a.teamId } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            actorId: true,
            teamId: true,
            payerKind: true,
            payerUserId: true,
            rateId: true,
            invocationId: true,
            kind: true,
            model: true,
            status: true,
            reserved: true,
            charged: true,
            costCny: true,
            costType: true,
            quoteLine: true,
            error: true,
            actualSupplier: true,
            createdAt: true,
          },
        }),
      };
    if (id === "ledger" && method === "GET")
      return {
        items: await systemDb.personalCreditLedger.findMany({
          where: {
            userId: a.userId,
            ...(a.type === "agent" ? { sourceTeamId: a.teamId } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      };
    if (id === "quotes" && method === "POST") return quoteBatch(a, body);
  }
  if (group === "platform") {
    requirePlatform(a);
    if (id === "rates" && method === "GET")
      return {
        items: await systemDb.purchaseRate.findMany({
          orderBy: { createdAt: "desc" },
        }),
      };
    if (id === "rates" && action === "official-deepseek" && method === "POST") {
      const channels = await systemDb.channel.findMany({
        where: { provider: "deepseek", enabled: true },
      });
      const items = [],
        skipped = [];
      for (const c of channels) {
        if (c.baseUrl.replace(/\/$/, "") !== "https://api.deepseek.com")
          continue;
        for (const kind of ["text", "vision"] as const) {
          if (!(c.models as any)[kind]?.includes(deepseekOfficialPrice.model))
            continue;
          const existing = await systemDb.purchaseRate.findFirst({
            where: {
              channelId: c.id,
              model: deepseekOfficialPrice.model,
              kind,
              supplier: "",
              resolution: "",
            },
          });
          if (existing) {
            skipped.push(existing.id);
            continue;
          }
          items.push(
            await saveRate(a, {
              channelId: c.id,
              kind,
              model: deepseekOfficialPrice.model,
              unit: "token",
              rate: deepseekOfficialPrice.rate,
              inputRate: deepseekOfficialPrice.inputRate,
              cachedInputRate: deepseekOfficialPrice.cachedInputRate,
              basis: deepseekOfficialPrice.basis,
            }),
          );
        }
      }
      return { items, skipped, source: deepseekOfficialPrice.source };
    }
    if (id === "rates" && method === "POST") return saveRate(a, body);
    if (id === "teams" && method === "GET") {
      const teams = await systemDb.team.findMany({
          orderBy: { createdAt: "desc" },
        }),
        wallets = await systemDb.wallet.findMany();
      return {
        items: teams.map((t) => ({
          ...t,
          wallet: wallets.find((w) => w.teamId === t.id),
        })),
      };
    }
    if (id === "teams" && action && method === "PATCH") {
      const archived = z.boolean().parse(body.archived);
      return systemDb.$transaction(async (tx) => {
        const w = await lockWallet(tx, action).catch(async () => {
          assert(!archived, 409, "团队已归档");
          return tx.wallet.findUniqueOrThrow({ where: { teamId: action } });
        });
        if (archived) {
          const count = await tx.job.count({
              where: {
                teamId: action,
                status: { notIn: ["succeeded", "failed", "cancelled"] },
              },
            }),
            runs = await tx.agentRun.count({
              where: { teamId: action, status: { in: ["running", "queued"] } },
            }),
            batches = await tx.productionBatch.count({
              where: { teamId: action, status: "pending_approval" },
            });
          assert(
            !count && !runs && !batches && w.frozen.eq(0),
            409,
            "团队存在未完成任务或冻结积分",
          );
        }
        await tx.auditEvent.create({
          data: {
            teamId: action,
            actorId: a.userId,
            actorType: "human",
            action: "platform.team_status",
            entityId: action,
            data: { archived },
          },
        });
        return tx.team.update({ where: { id: action }, data: { archived } });
      });
    }
    if (id === "credits" && method === "POST") {
      const d = z
        .object({
          teamId: z.string(),
          amount: z.coerce
            .number()
            .refine((v) => v !== 0 && Number.isFinite(v)),
          reason: z.string().min(3).max(500),
          eventKey: z.string().min(8).max(200),
        })
        .parse(body);
      return withTeam(d.teamId, () =>
        db.$transaction(async (tx) => {
          const w = await lockWallet(tx, d.teamId),
            old = await tx.creditLedger.findUnique({
              where: { eventKey: "adjust:" + d.eventKey },
            });
          if (old) {
            assert(
              old.amount.eq(d.amount) && old.reason === d.reason,
              409,
              "幂等请求已变化",
            );
            return old;
          }
          assert(
            w.balance.add(d.amount).gte(w.frozen),
            409,
            "调整后可用积分不能为负数",
          );
          await tx.wallet.update({
            where: { id: w.id },
            data: { balance: { increment: d.amount } },
          });
          return tx.creditLedger.create({
            data: {
              teamId: d.teamId,
              eventKey: "adjust:" + d.eventKey,
              actorId: a.userId,
              kind: "adjust",
              amount: d.amount,
              reason: d.reason,
            },
          });
        }),
      );
    }
    if (id === "reconcile" && method === "GET")
      return {
        items: await systemDb.usageRecord.findMany({
          where: { status: "reconcile" },
          select: {
            id: true,
            teamId: true,
            actorId: true,
            model: true,
            status: true,
            reserved: true,
            costCny: true,
            error: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
          take: 100,
        }),
      };
    if (id === "reconcile" && action && method === "POST") {
      const d = z
        .object({
          costCny: z.coerce.number().nonnegative(),
          reason: z.string().min(3),
        })
        .parse(body);
      return settleUsage(action, d.costCny, "manual", {
        reason: d.reason,
        operator: a.userId,
      });
    }
  }
  return undefined;
}
