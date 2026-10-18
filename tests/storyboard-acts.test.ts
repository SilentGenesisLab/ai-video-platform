import { describe, it, expect } from "vitest";
import { suggestActs, actScript } from "../src/lib/storyboard-acts";
import { contentSchemas } from "../src/lib/contracts";
const shots = Array.from({ length: 9 }, (_, i) => ({
  id: `s${i}`,
  number: i + 1,
  duration: 5,
  description: `画面${i}`,
  assets: [],
  candidateFileIds: [],
}));
describe("storyboard acts", () => {
  it("suggests three 15 second clips preserving every stable shot ID", () => {
    const acts = suggestActs(shots);
    expect(acts.map((a) => a.shotIds.length)).toEqual([3, 3, 3]);
    expect(acts.flatMap((a) => a.shotIds)).toEqual(shots.map((s) => s.id));
  });
  it("accepts legacy boards and rejects duplicate, missing or reordered membership", () => {
    expect(contentSchemas.storyboard.safeParse({ shots }).success).toBe(true);
    const acts = suggestActs(shots);
    expect(contentSchemas.storyboard.safeParse({ shots, acts }).success).toBe(
      true,
    );
    for (const bad of [
      [...acts, acts[0]],
      acts.slice(1),
      [acts[1], acts[0], acts[2]],
    ])
      expect(
        contentSchemas.storyboard.safeParse({ shots, acts: bad }).success,
      ).toBe(false);
  });
  it("converts exact immutable source version and asset versions without generation", () => {
    const acts = suggestActs(shots);
    const board = {
      id: "board",
      title: "测试",
      productId: "p",
      planId: "plan",
      version: 7,
      content: {
        shots: shots.map((s) => ({
          ...s,
          assets: [{ resourceId: "asset", version: 2 }],
          imageFileId: "image",
        })),
        acts,
      },
    };
    const script = actScript(board, acts[0], {
      content: { aspectRatio: "9:16" },
    });
    expect(script.sources).toEqual([{ resourceId: "board", version: 7 }]);
    expect(script.content.duration).toBe(15);
    expect(script.content.assets).toEqual([
      { resourceId: "asset", version: 2 },
    ]);
    expect(script.content.referenceFileIds).toEqual(["image"]);
    expect(script.content.shotIds).toEqual(["s0", "s1", "s2"]);
    expect(contentSchemas.script.safeParse(script.content).success).toBe(true);
  });
  it("blocks overlong and fractional clips instead of silently changing duration", () => {
    for (const duration of [21, 9.5, 3])
      expect(() =>
        actScript(
          { content: { shots: [{ id: "a", duration }] } },
          { shotIds: ["a"] },
          {},
        ),
      ).toThrow();
  });
});
