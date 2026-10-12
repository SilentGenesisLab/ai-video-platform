import { expect, it, vi } from "vitest";
vi.mock("../src/lib/db", () => ({
  db: { purchaseRate: { findMany: async () => [{ id: "official-video-rate", supplier: "", resolution: "", version: 1, pricingParameters: {}, unit: "token", rate: 30, inputRate: 6, cachedInputRate: 1.2, basis: "Test official token rate" }] } },
  systemDb: {}, withTeam: (_: unknown, fn: () => unknown) => fn(),
}));
import { rateLine } from "../src/lib/billing";
it("reserves video context tokens instead of treating a URL as the complete model input", async () => {
  const quote = await rateLine("ark", "doubao-seed-2-1-pro-260628", "video_understanding", {}, { duration_seconds: 10, max_tokens: 8192 });
  expect(quote.units).toBe(1000000);
  expect(quote.costCny).toBe("6.24576");
});
