import { systemDb as db, withTeam } from "./db";
import { teamActor } from "./auth";
import { saveRate, rateLine } from "./billing";
function holidayDates() {
  const ranges = [
    ["2026-01-01", 3],
    ["2026-02-15", 9],
    ["2026-04-04", 3],
    ["2026-05-01", 5],
    ["2026-06-19", 3],
    ["2026-09-25", 3],
    ["2026-10-01", 7],
  ] as const;
  return ranges.flatMap(([start, count]) =>
    Array.from({ length: count }, (_, i) =>
      new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10),
    ),
  );
}
/** Versioned public CNY pricing verified 2026-10-12. Never replace administrator prices. */
export async function seedOfficialPrices() {
  const admin = await db.user.findFirst({
    where: { platformAdmin: true, active: true },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) return;
  const membership = await db.teamMember.findFirst({
    where: { userId: admin.id, active: true },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) return;
  const actor = await teamActor(admin, membership.teamId);
  const channels = await db.channel.findMany({ where: { enabled: true } });
  for (const c of channels) {
    for (const [kind, models] of Object.entries(
      c.models as Record<string, string[]>,
    ))
      for (const model of models) {
        const existing = await db.purchaseRate.findFirst({
          where: {
            channelId: c.id,
            model,
            kind,
            sourceType: "verified",
            supplier: "",
          },
          orderBy: { version: "desc" },
        });
        // Add source/schedule metadata to the previous official seed as a new version.
        // Contract prices entered by an operator are always preserved.
        const priorOfficial =
          existing &&
          !existing.sourceUrl &&
          !existing.checkedAt &&
          ((c.provider === "deepseek" &&
            existing.basis.startsWith("DeepSeek 官方人民币")) ||
            (c.provider === "volcengine" &&
              existing.basis.startsWith("火山方舟官方在线推理")));
        if (existing && !priorOfficial) continue;
        const base = {
          channelId: c.id,
          model,
          kind,
          unit: "token",
          checkedAt: new Date("2026-10-12T00:00:00Z"),
        };
        if (
          c.provider === "deepseek" &&
          new URL(c.baseUrl).hostname === "api.deepseek.com" &&
          model === "deepseek-flash" &&
          ["text", "vision"].includes(kind)
        ) {
          await withTeam(actor.teamId, () =>
            saveRate(actor, {
              ...base,
              inputRate: 2,
              cachedInputRate: 0.04,
              rate: 8,
              sourceUrl:
                "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
              basis:
                "DeepSeek 官方人民币公开价；输入/缓存/输出每百万Token，高峰2/0.04/8，空闲减半；2026节假日按国务院安排。",
              billingSchedule: {
                timezone: "Asia/Shanghai",
                peakWeekdays: [1, 2, 3, 4, 5],
                peakHours: [
                  [540, 720],
                  [840, 1080],
                ],
                holidayDates: holidayDates(),
                offPeakMultiplier: 0.5,
              },
            }),
          );
        } else if (
          c.provider === "volcengine" &&
          new URL(c.baseUrl).hostname === "ark.cn-beijing.volces.com" &&
          model === "doubao-seed-2-1-pro-260628" &&
          kind === "video_understanding"
        ) {
          await withTeam(actor.teamId, () =>
            saveRate(actor, {
              ...base,
              inputRate: 6,
              cachedInputRate: 1.2,
              rate: 30,
              sourceUrl:
                "https://docs.volcengine.com/docs/ark/model-pricing?lang=en&redirect=1",
              basis:
                "火山方舟在线推理标准后付费人民币公开价；非音频输入6/缓存1.2/输出30元每百万Token，不使用低优折扣价格。",
            }),
          );
        } else {
          await rateLine(c.id, model, kind, {}, {});
        }
      }
  }
  console.log(
    "Official CNY prices initialized; unverified providers use explicitly estimated defaults.",
  );
}
