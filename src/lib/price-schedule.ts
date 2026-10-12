import { z } from "zod";
export const scheduleSchema = z.object({
  timezone: z.literal("Asia/Shanghai").default("Asia/Shanghai"),
  peakWeekdays: z
    .array(z.number().int().min(0).max(6))
    .default([1, 2, 3, 4, 5]),
  peakHours: z
    .array(
      z
        .tuple([
          z.number().int().min(0).max(1440),
          z.number().int().min(0).max(1440),
        ])
        .refine(([a, b]) => a < b),
    )
    .default([
      [540, 720],
      [840, 1080],
    ]),
  holidayDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
  offPeakMultiplier: z.number().positive().max(1).default(0.5),
});
export function priceMultiplier(schedule: unknown, at: Date) {
  if (!schedule || !Object.keys(schedule as object).length) return 1;
  const s = scheduleSchema.parse(schedule);
  const local = new Date(at.getTime() + 8 * 3600000),
    date = local.toISOString().slice(0, 10),
    minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const peak =
    s.peakWeekdays.includes(local.getUTCDay()) &&
    !s.holidayDates.includes(date) &&
    s.peakHours.some(([start, end]) => minutes >= start && minutes < end);
  return peak ? 1 : s.offPeakMultiplier;
}
