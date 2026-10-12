import { assert } from "./errors";
import type { Actor } from "./auth";
export const permissionGroups = [
  {
    id: "product",
    label: "产品管理",
    actions: [
      ["read", "查看产品"],
      ["write", "创建与编辑产品"],
    ],
  },
  {
    id: "creative",
    label: "创意策划",
    actions: [
      ["read", "查看创意、策划案与分镜"],
      ["write", "编辑创意、策划案与分镜"],
      ["generate", "生成分镜图与总览"],
    ],
  },
  {
    id: "asset",
    label: "资产制作",
    actions: [
      ["read", "查看资产"],
      ["write", "编辑资产"],
      ["generate", "生成图片与音乐"],
    ],
  },
  {
    id: "video",
    label: "视频制作",
    actions: [
      ["read", "查看制作脚本与成片"],
      ["write", "编辑制作脚本与成片"],
      ["generate", "提交视频生成审批"],
    ],
  },
  {
    id: "file",
    label: "文件资料",
    actions: [
      ["read", "查看与下载文件"],
      ["write", "上传与管理文件"],
      ["analyze", "解析与识别文件"],
    ],
  },
  {
    id: "chat",
    label: "创作搭档",
    actions: [
      ["read", "查看自己的会话"],
      ["execute", "发送消息与执行"],
      ["control", "暂停与继续"],
    ],
  },
  { id: "channel", label: "渠道模型", actions: [["read", "查看模型及能力"]] },
  {
    id: "operations",
    label: "日志与积分",
    actions: [
      ["logs", "查看任务与操作日志"],
      ["billing", "查看本人积分与本团队用量"],
    ],
  },
] as const;
export const permissionCatalog = permissionGroups.flatMap((g) =>
  g.actions.map(([action, label]) => ({
    id: `${g.id}.${action}`,
    label,
    group: g.id,
    scope:
      action === "generate" || action === "execute"
        ? "generate"
        : action === "control" || action === "analyze" || action === "write"
          ? "write"
          : "read",
    dependencies:
      action === "read" || g.id === "operations" ? [] : [`${g.id}.read`],
  })),
);
export const permissionIds = permissionCatalog.map((p) => p.id);
export const recommendedPermissions = permissionIds.filter(
  (id) => !id.startsWith("operations."),
);
export function legacyPermissions(scopes: string[]) {
  return permissionCatalog
    .filter((p) => scopes.includes(p.scope))
    .map((p) => p.id);
}
export function permissionsOf(a: Pick<Actor, "scopes" | "permissions">) {
  return Array.isArray(a.permissions)
    ? a.permissions
    : legacyPermissions(a.scopes);
}
export function hasPermission(a: Actor, id: string) {
  return permissionsOf(a).includes(id);
}
export function requirePermission(a: Actor, id: string) {
  if (a.type === "human") return;
  assert(
    hasPermission(a, id),
    403,
    "API Key 没有此模块的操作权限",
    "KEY_PERMISSION",
  );
}
export function validatePermissions(ids: string[]) {
  assert(
    ids.length > 0 &&
      new Set(ids).size === ids.length &&
      ids.every((id) => permissionIds.includes(id)),
    422,
    "请选择有效权限",
  );
  assert(
    ids.every((id) =>
      permissionCatalog
        .find((p) => p.id === id)!
        .dependencies.every((d) => ids.includes(d)),
    ),
    422,
    "编辑、生成及执行权限需同时授予对应模块的查看权限",
  );
}
export function scopeSummary(ids: string[]) {
  return [
    ...new Set([
      ...permissionCatalog
        .filter((p) => ids.includes(p.id))
        .map((p) => p.scope),
      ...(ids.includes("chat.execute") ? ["write"] : []),
    ]),
  ];
}
export function resourceModule(kind: string) {
  if (kind === "product") return "product";
  if (["creative-batch", "concept", "plan", "storyboard"].includes(kind))
    return "creative";
  if (kind === "asset") return "asset";
  if (["script", "deliverable"].includes(kind)) return "video";
  return "";
}
export function allowedResourceKinds(a: Actor) {
  return [
    "product",
    "creative-batch",
    "concept",
    "plan",
    "storyboard",
    "asset",
    "script",
    "deliverable",
  ].filter((k) => hasPermission(a, resourceModule(k) + ".read"));
}
export function mediaPermission(kind: string, entries: any[] = []) {
  if (kind === "video") return "video.generate";
  if (kind === "overview" || entries.some((e) => e.targetShotId))
    return "creative.generate";
  return "asset.generate";
}
export function jobPermission(kind: string) {
  if (["image", "audio"].includes(kind)) return "asset.read";
  if (kind === "video") return "video.read";
  if (kind === "overview") return "creative.read";
  return "file.read";
}
