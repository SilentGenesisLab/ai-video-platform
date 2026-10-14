import type { Actor } from "./auth";
import { requireHuman } from "./auth";
import { db } from "./db";
import { assert } from "./errors";
import {
  requirePermission,
  hasPermission,
  resourceModule,
} from "./permissions";
const modules: Record<string, string> = {
  products: "product",
  "creative-batches": "creative",
  concepts: "creative",
  plans: "creative",
  storyboards: "creative",
  assets: "asset",
  scripts: "video",
  deliverables: "video",
};
export async function batchPermissionIds(
  kind: string,
  entries: any[] = [],
  operation = "generate",
) {
  const ids = new Set<string>();
  for (const entry of entries.length ? entries : [{}]) {
    let module = kind === "video" ? "video" : "asset";
    if (kind === "image" && entry.targetShotId) module = "creative";
    if (kind === "image" && entry.targetResourceId) {
      const target = await db.resource.findUnique({
        where: { id: entry.targetResourceId },
        select: { kind: true },
      });
      if (target?.kind === "storyboard") module = "creative";
    }
    ids.add(module + "." + operation);
  }
  return [...ids];
}
export async function checkBatchPermission(a: Actor, body: any) {
  if (a.type === "human") return;
  for (const id of await batchPermissionIds(body.kind, body.entries))
    requirePermission(a, id);
}
export async function canReadBatch(a: Actor, batch: any) {
  return (
    a.type === "human" ||
    (
      await batchPermissionIds(
        batch.kind,
        (batch.snapshot as any)?.entries,
        "read",
      )
    ).every((id) => hasPermission(a, id))
  );
}
export async function canReadJob(a: Actor, job: any) {
  if (a.type === "human") return true;
  const kind = job.kind;
  if (kind === "concept_scoring") return false;
  if (kind === "reference_search") return hasPermission(a, "creative.read");
  if (["image", "audio", "video"].includes(kind))
    return (await batchPermissionIds(kind, [job.input], "read")).every((id) =>
      hasPermission(a, id),
    );
  return hasPermission(a, kind === "overview" ? "creative.read" : "file.read");
}
export async function guardRequest(
  a: Actor,
  parts: string[],
  method: string,
  body: any,
) {
  if (a.type === "human") return;
  const [group, id, action] = parts;
  if (
    [
      "api-keys",
      "members",
      "teams",
      "invitations",
      "platform",
      "admin",
      "account",
      "feedback",
    ].includes(group)
  )
    requireHuman(a);
  if (modules[group]) {
    requirePermission(
      a,
      modules[group] +
        (action === "overview"
          ? ".generate"
          : method === "GET"
            ? ".read"
            : ".write"),
    );
    return;
  }
  if (group === "channels") {
    if (method !== "GET") requireHuman(a);
    requirePermission(a, "channel.read");
  }
  if (group === "files") {
    requirePermission(a, "file.read");
    if (method !== "GET") {
      const analyze = ["analyses", "retry-analysis", "retry-parse"].includes(
        action,
      );
      requirePermission(a, analyze ? "file.analyze" : "file.write");
      if (!id && body.parsePolicy !== "skip" && !body.conversationId)
        requirePermission(a, "file.analyze");
      if (id && action === "complete") {
        const f = await db.fileObject.findUnique({
          where: { id },
          select: { metadata: true, conversationId: true },
        });
        if (
          f &&
          !f.conversationId &&
          (f.metadata as any)?.parsePolicy !== "skip"
        )
          requirePermission(a, "file.analyze");
      }
      if (action === "save-to-product") requirePermission(a, "product.write");
    }
  }
  if (group === "conversations") {
    requirePermission(a, "chat.read");
    if (method !== "GET")
      requirePermission(
        a,
        action === "imports" ? "file.write" : "chat.execute",
      );
  }
  if (group === "agent-runs")
    requirePermission(a, method === "GET" ? "chat.read" : "chat.control");
  if (group === "tools") {
    if (id === "generate-media")
      await checkBatchPermission(a, { kind: body.kind, entries: [body] });
    else requirePermission(a, "chat.execute");
  }
  if (group === "audit-events") requirePermission(a, "operations.logs");
  if (group === "billing") {
    if (id === "quotes" && method === "POST")
      await checkBatchPermission(a, body);
    else requirePermission(a, "operations.billing");
  }
  if (group === "production-batches" && method === "POST")
    await checkBatchPermission(a, body);
  if (group === "jobs" && method !== "GET" && id) {
    const job = await db.job.findUnique({ where: { id } });
    assert(
      job && (await canReadJob(a, job)),
      403,
      "无权操作此模块的任务",
      "KEY_PERMISSION",
    );
    if (["image", "audio", "video"].includes(job.kind))
      for (const p of await batchPermissionIds(job.kind, [job.input]))
        requirePermission(a, p);
    else
      requirePermission(
        a,
        job.kind === "overview" ? "creative.generate" : "file.analyze",
      );
  }
}
