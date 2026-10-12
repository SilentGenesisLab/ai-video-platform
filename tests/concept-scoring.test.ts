import { describe, it, expect } from "vitest";
import { rubric, evaluateScores, isUnscored } from "../src/lib/concept-scoring";
describe("weighted concept scoring", () => {
  it("computes weights on server, ignores model totals", () => {
    const result = evaluateScores({
      dimensions: rubric.map((r, i) => ({
        key: r.key,
        score: [8, 6, 7, 9, 5][i],
        reason: "可验证的依据",
      })),
      total: 10,
    });
    expect(result.total).toBe(7);
    expect(result.dimensions.reduce((a, d) => a + d.weight, 0)).toBe(1);
  });
  it("preserves manual scores including zero", () => {
    expect(isUnscored({ score: 0 })).toBe(false);
    expect(isUnscored({ score: 8 })).toBe(false);
    expect(isUnscored({})).toBe(true);
  });
  it("rejects duplicate dimensions and invalid scores", () => {
    const dimensions = rubric.map((r) => ({
      key: r.key,
      score: 8,
      reason: "依据",
    }));
    expect(() =>
      evaluateScores({
        dimensions: [...dimensions.slice(0, 4), dimensions[0]],
      }),
    ).toThrow();
    expect(() =>
      evaluateScores({
        dimensions: dimensions.map((d) => ({ ...d, score: 11 })),
      }),
    ).toThrow();
  });
});
