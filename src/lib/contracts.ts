import { z } from "zod";
import { productContentSchema } from "./product-content";
export const kinds = [
  "product",
  "creative-batch",
  "concept",
  "plan",
  "storyboard",
  "asset",
  "script",
  "deliverable",
] as const;
export type Kind = (typeof kinds)[number];
export const routes: Record<string, Kind> = {
  products: "product",
  "creative-batches": "creative-batch",
  concepts: "concept",
  plans: "plan",
  storyboards: "storyboard",
  assets: "asset",
  scripts: "script",
  deliverables: "deliverable",
};
const text = z.string().max(100000),
  strings = z.array(z.string()).max(1000);
export const sourceSchema = z.object({
  resourceId: z.string(),
  version: z.number().int().positive(),
});
export const shotSchema = z.object({
  id: z.string().min(1),
  number: z.number().int().positive(),
  duration: z.number().positive().max(300),
  description: text,
  framing: text.default(""),
  camera: text.default(""),
  movement: text.default(""),
  action: text.default(""),
  dialogue: text.default(""),
  sound: text.default(""),
  continuity: text.default(""),
  assets: z.array(sourceSchema).default([]),
  imageFileId: z.string().optional(),
  candidateFileIds: strings.default([]),
});
export const contentSchemas: Record<Kind, z.ZodType> = {
  product: productContentSchema,
  "creative-batch": z.object({
    requirements: text.default(""),
    count: z.number().int().min(1).max(100).default(10),
  }),
  concept: z.object({
    hook: text.default(""),
    idea: text.default(""),
    structure: text.default(""),
    emotion: text.default(""),
    selfReview: text.default(""),
    score: z.number().min(0).max(10).optional(),
    comments: text.default(""),
  }),
  plan: z.object({
    objective: text.default(""),
    audience: text.default(""),
    message: text.default(""),
    story: text.default(""),
    visualStyle: text.default(""),
    sound: text.default(""),
    duration: z.number().positive().max(3600).default(30),
    aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:3", "3:4"]).default("16:9"),
    body: text.default(""),
  }),
  storyboard: z
    .object({ shots: z.array(shotSchema).default([]) })
    .refine(
      (v) =>
        new Set(v.shots.map((s) => s.id)).size === v.shots.length &&
        new Set(v.shots.map((s) => s.number)).size === v.shots.length,
      "镜头编号和 ID 不能重复",
    ),
  asset: z.object({
    category: z
      .enum(["product", "character", "environment", "prop", "reference"])
      .default("reference"),
    purpose: text.default(""),
    constraints: text.default(""),
    prompt: text.default(""),
    parameters: z.record(z.string(), z.unknown()).default({}),
    referenceFileIds: strings.default([]),
    candidateFileIds: strings.default([]),
    selectedFileId: z.string().optional(),
    comments: text.default(""),
  }),
  script: z.object({
    prompt: text.default(""),
    shotIds: strings.default([]),
    assets: z.array(sourceSchema).default([]),
    referenceFileIds: strings.default([]),
    duration: z.number().int().min(4).max(30).default(5),
    aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:3", "3:4"]).default("16:9"),
    resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
    sound: z.boolean().default(false),
    comments: text.default(""),
  }),
  deliverable: z.object({
    fileId: z.string().min(1),
    sourceJobIds: strings.default([]),
    notes: text.default(""),
  }),
};
export const resourceInput = z.object({
  title: z.string().min(1).max(240),
  productId: z.string().optional(),
  planId: z.string().optional(),
  parentId: z.string().optional(),
  status: z
    .enum(["draft", "selected", "rejected", "archived", "ready"])
    .default("draft"),
  content: z.record(z.string(), z.unknown()).default({}),
  sources: z.array(sourceSchema).default([]),
  baseVersion: z.number().int().positive().optional(),
});
export const keyInput = z.object({
  name: z.string().min(1).max(100),
  note: z.string().max(1000).default(""),
  ownerId: z.string().optional(),
  scopes: z
    .array(z.enum(["read", "write", "generate"]))
    .min(1)
    .default(["read", "write", "generate"]),
  productIds: strings.default([]),
  expiresAt: z.iso.datetime().nullable().optional(),
  enabled: z.boolean().default(true),
});
export const generationEntry = z.object({
  prompt: z.string().min(1).max(10000),
  model: z.string().min(1),
  channel: z.string().default("auto"),
  channelId: z.string().min(1),
  referenceFileIds: strings.max(50).default([]),
  sources: z.array(sourceSchema).default([]),
  targetResourceId: z.string().optional(),
  targetShotId: z.string().optional(),
  parameters: z
    .object({
      duration_seconds: z.number().int().optional(),
      resolution: z.string().optional(),
      aspect_ratio: z.string().optional(),
      sound: z.boolean().optional(),
      image_size: z.string().optional(),
      instrumental: z.boolean().optional(),
      title: z.string().optional(),
      tags: z.string().optional(),
      loop: z.boolean().optional(),
      sound_model: z.enum(["chirp-crow", "chirp-fenix"]).optional(),
      music_model: z
        .enum(["chirp-hawk", "chirp-hawk-wild", "chirp-goose"])
        .optional(),
      lyrics: z.string().max(5000).optional(),
    })
    .default({}),
});
export const batchInput = z.object({
  quoteId: z.string().optional(),
  title: z.string().min(1).max(240),
  productId: z.string(),
  planId: z.string().optional(),
  kind: z.enum(["image", "video", "audio"]),
  entries: z.array(generationEntry).min(1).max(100),
  baseVersion: z.number().int().positive().optional(),
});
export type GenerationEntry = z.infer<typeof generationEntry>;
export const roleInput = z.enum(["admin", "editor", "reviewer", "viewer"]);
