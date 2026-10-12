import { describe, it, expect } from "vitest";
import { priceMultiplier } from "../src/lib/price-schedule";
const schedule = {
  timezone: "Asia/Shanghai",
  peakWeekdays: [1, 2, 3, 4, 5],
  peakHours: [
    [540, 720],
    [840, 1080],
  ],
  holidayDates: ["2026-10-01"],
  offPeakMultiplier: 0.5,
};
describe("public CNY time pricing", () => {
  it("charges peak during weekday intervals", () =>
    expect(
      priceMultiplier(schedule, new Date("2026-10-12T10:00:00+08:00")),
    ).toBe(1));
  it("uses half price after 18:00", () =>
    expect(
      priceMultiplier(schedule, new Date("2026-10-12T18:00:00+08:00")),
    ).toBe(0.5));
  it("uses half price on weekends and holidays", () => {
    expect(
      priceMultiplier(schedule, new Date("2026-10-11T10:00:00+08:00")),
    ).toBe(0.5);
    expect(
      priceMultiplier(schedule, new Date("2026-10-01T10:00:00+08:00")),
    ).toBe(0.5);
  });
  it("leaves prices without schedules unchanged", () =>
    expect(priceMultiplier({}, new Date())).toBe(1));
});
