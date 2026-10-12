import { z } from "zod";
export const rubric = [
  { key: "alignment", label: "产品与用户契合", weight: 0.25 },
  { key: "hook", label: "钩子吸引力", weight: 0.25 },
  { key: "originality", label: "差异化与原创性", weight: 0.2 },
  { key: "structure", label: "叙述与营销逻辑", weight: 0.15 },
  { key: "feasibility", label: "拍摄与制作可行性", weight: 0.15 },
];
export const evaluationSchema = z.object({
  rubricVersion: z.literal("v1"),
  sourceVersion: z.number().int().positive(),
  model: z.string(),
  gradedAt: z.string(),
  dimensions: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        weight: z.number(),
        score: z.number().min(0).max(10),
        reason: z.string().min(1).max(3000),
      }),
    )
    .length(5),
  total: z.number().min(0).max(10),
});
export function evaluateScores(raw: unknown) {
  const parsed = z
    .object({
      dimensions: z
        .array(
          z.object({
            key: z.string(),
            score: z.number().min(0).max(10),
            reason: z.string().min(1).max(3000),
          }),
        )
        .length(5),
    })
    .parse(raw);
  const dimensions = rubric.map((r) => {
    const matches = parsed.dimensions.filter((d) => d.key === r.key);
    if (matches.length !== 1) throw new Error("评分维度缺失或重复");
    return { ...matches[0], ...r };
  });
  return {
    dimensions,
    total:
      Math.round(
        dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) * 100,
      ) / 100,
  };
}
export function isUnscored(content: any) {
  return content?.score === undefined || content?.score === null;
}
