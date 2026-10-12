import { z } from "zod";
import { HttpError } from "./errors";

const text = z.string().max(100000);
const short = z.string().trim().min(1).max(100000);
const id = z.string().min(1).max(100);
const url = z.union([
  z.literal(""),
  z
    .url()
    .refine(
      (v) => ["http:", "https:"].includes(new URL(v).protocol),
      "仅支持 HTTP/HTTPS 链接",
    ),
]);
const evidence = {
  evidence: text.default(""),
  fileIds: z.array(id).max(100).default([]),
  sourceUrl: url.default(""),
};
const list = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .max(1000)
    .refine(
      (items) => new Set(items.map((i: any) => i.id)).size === items.length,
      "条目 ID 不能重复",
    );
export const productContentSchema = z.object({
  description: text.default(""),
  positioning: text.default(""),
  sellingPoints: z.array(text).max(1000).default([]),
  audience: text.default(""),
  brief: text.default(""),
  fileIds: z.array(id).max(1000).default([]),
  coverFileId: id.optional(),
  sellingPointItems: list(
    z.object({
      id,
      title: short,
      feature: text.default(""),
      benefit: text.default(""),
      ...evidence,
    }),
  ).optional(),
  audienceSegments: list(
    z.object({
      id,
      name: short,
      scenario: text.default(""),
      pain: text.default(""),
      needs: text.default(""),
      objections: text.default(""),
    }),
  ).optional(),
  userQuotes: list(
    z.object({
      id,
      text: text.trim().min(1),
      source: text.default(""),
      ...evidence,
    }),
  ).optional(),
  facts: z
    .array(
      z.object({
        id: id.optional(),
        text: text.trim().min(1),
        kind: z.enum(["fact", "hypothesis"]),
        fileId: id.optional(),
        sourceUrl: url.default(""),
        source: text.default(""),
      }),
    )
    .max(1000)
    .default([]),
  questions: list(
    z.object({
      id,
      text: text.trim().min(1),
      note: text.default(""),
      status: z.enum(["pending", "confirmed"]).default("pending"),
    }),
  ).optional(),
  materials: list(
    z.object({
      id,
      fileId: id,
      category: z.enum(["product-image", "product-video", "document", "other"]),
      title: text.max(240).default(""),
      note: text.default(""),
    }),
  ).optional(),
  referenceVideos: list(
    z
      .object({
        id,
        title: short,
        type: z.enum(["file", "link"]),
        fileId: id.optional(),
        url: url.default(""),
        source: text.default(""),
        purpose: text.default(""),
        tags: z.array(z.string().max(100)).max(100).default([]),
        hook: text.default(""),
        structure: text.default(""),
        rhythm: text.default(""),
        shots: text.default(""),
        sound: text.default(""),
        takeaways: text.default(""),
        avoid: text.default(""),
      })
      .refine(
        (r) =>
          r.type === "file" ? !!r.fileId && !r.url : !!r.url && !r.fileId,
        "请选择上传视频或外部链接，不能同时指定",
      ),
  ).optional(),
});

export function materialCategory(mime = "") {
  return mime.startsWith("image/")
    ? "product-image"
    : mime.startsWith("video/")
      ? "product-video"
      : /text\/|pdf|wordprocessingml/.test(mime)
        ? "document"
        : "other";
}

/** Read adapter: deterministic IDs, no database writes and no changes to historical revisions. */
export function adaptProductContent(
  raw: any = {},
  files: { id: string; mime: string; name?: string }[] = [],
) {
  const c = { ...raw };
  return {
    ...c,
    description: c.description ?? "",
    positioning: c.positioning ?? "",
    brief: c.brief ?? "",
    sellingPoints: c.sellingPoints ?? [],
    audience: c.audience ?? "",
    fileIds: c.fileIds ?? [],
    sellingPointItems:
      c.sellingPointItems ??
      (c.sellingPoints ?? [])
        .filter((s: string) => s.trim())
        .map((title: string, i: number) => ({
          id: `legacy-selling-${i}`,
          title,
          feature: "",
          benefit: "",
          evidence: "",
          fileIds: [],
          sourceUrl: "",
        })),
    audienceSegments:
      c.audienceSegments ??
      (c.audience ?? "")
        .split(/\r?\n/)
        .filter((s: string) => s.trim())
        .map((name: string, i: number) => ({
          id: `legacy-audience-${i}`,
          name,
          scenario: "",
          pain: "",
          needs: "",
          objections: "",
        })),
    userQuotes: c.userQuotes ?? [],
    questions: c.questions ?? [],
    referenceVideos: c.referenceVideos ?? [],
    facts: (c.facts ?? []).map((f: any, i: number) => ({
      ...f,
      id: f.id ?? `legacy-fact-${i}`,
      source: f.source ?? "",
      sourceUrl: f.sourceUrl ?? "",
    })),
    materials:
      c.materials ??
      [...new Set<string>(c.fileIds ?? [])].map((fileId: string) => {
        const file = files.find((f) => f.id === fileId);
        return {
          id: `legacy-material-${fileId}`,
          fileId,
          category: materialCategory(file?.mime),
          title: file?.name ?? "",
          note: "",
        };
      }),
  };
}

export function normalizeProductUpdate(
  previous: any,
  incoming: any,
  files: { id: string; mime: string; name?: string }[] = [],
) {
  for (const [legacy, modern] of [
    ["sellingPoints", "sellingPointItems"],
    ["audience", "audienceSegments"],
    ["fileIds", "materials"],
  ]) {
    if (
      previous?.[modern] !== undefined &&
      Object.hasOwn(incoming, legacy) &&
      !Object.hasOwn(incoming, modern) &&
      JSON.stringify(incoming[legacy]) !== JSON.stringify(previous[legacy])
    ) {
      throw new HttpError(
        409,
        `产品已使用结构化资料，请读取最新产品后修改 ${modern}，避免覆盖已有信息`,
        "PRODUCT_STRUCTURE_CONFLICT",
      );
    }
  }
  const merged = { ...(previous ?? {}), ...incoming };
  const c = productContentSchema.parse(adaptProductContent(merged, files));
  c.sellingPoints = c.sellingPointItems!.map((s) => s.title);
  c.audience = c.audienceSegments!.map((s) => s.name).join("\n");
  c.fileIds = [...new Set(c.materials!.map((m) => m.fileId))];
  if (new Set(c.facts.map((f) => f.id)).size !== c.facts.length)
    throw new HttpError(422, "事实条目 ID 不能重复");
  return c;
}
