import { describe, expect, it } from "vitest";
import {
  adaptProductContent,
  normalizeProductUpdate,
  productContentSchema,
} from "../src/lib/product-content";

describe("product insight compatibility", () => {
  it("adapts legacy data deterministically without modifying the original", () => {
    const old = {
      sellingPoints: ["低维护成本"],
      audience: "园区管理者\n骑行者",
      brief: "# 旧 Brief",
      fileIds: ["image-1"],
      facts: [{ text: "尺寸待确认", kind: "hypothesis" }],
    };
    const before = structuredClone(old);
    const first = adaptProductContent(old, [
      { id: "image-1", mime: "image/png", name: "产品.png" },
    ]);
    expect(first.materials[0].category).toBe("product-image");
    expect(first.audienceSegments).toHaveLength(2);
    expect(first.facts[0].id).toBe("legacy-fact-0");
    expect(first.sellingPointItems).toEqual(
      adaptProductContent(old).sellingPointItems,
    );
    expect(old).toEqual(before);
  });
  it("preserves omitted detailed fields and supplies legacy summaries", () => {
    const prior = normalizeProductUpdate(null, {
      sellingPointItems: [
        {
          id: "s1",
          title: "节省空间",
          feature: "上下双层",
          benefit: "增加车位",
          evidence: "现场测量",
        },
      ],
      audienceSegments: [{ id: "u1", name: "园区", objections: "维护成本" }],
      brief: "# 保留",
    });
    const next = normalizeProductUpdate(prior, { description: "新描述" });
    expect(next.sellingPointItems?.[0].evidence).toBe("现场测量");
    expect(next.audienceSegments?.[0].objections).toBe("维护成本");
    expect(next.brief).toBe("# 保留");
    expect(next.sellingPoints).toEqual(["节省空间"]);
    expect(next.audience).toBe("园区");
  });
  it("rejects lossy legacy edits but accepts unchanged legacy echoes", () => {
    const prior = normalizeProductUpdate(null, {
      sellingPoints: ["原卖点"],
      audience: "原用户",
    });
    expect(() =>
      normalizeProductUpdate(prior, { sellingPoints: ["另一卖点"] }),
    ).toThrow("结构化资料");
    expect(() =>
      normalizeProductUpdate(prior, {
        sellingPoints: prior.sellingPoints,
        description: "修改",
      }),
    ).not.toThrow();
    expect(
      normalizeProductUpdate(prior, { sellingPointItems: [] }).sellingPoints,
    ).toEqual([]);
  });
  it("rejects duplicate IDs, unsafe sources and ambiguous video references", () => {
    expect(
      productContentSchema.safeParse({
        questions: [
          { id: "q", text: "a" },
          { id: "q", text: "b" },
        ],
      }).success,
    ).toBe(false);
    expect(
      productContentSchema.safeParse({
        referenceVideos: [
          { id: "r", title: "参考", type: "link", url: "javascript:alert(1)" },
        ],
      }).success,
    ).toBe(false);
    expect(
      productContentSchema.safeParse({
        referenceVideos: [
          {
            id: "r",
            title: "参考",
            type: "file",
            fileId: "f",
            url: "https://example.org/v",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
