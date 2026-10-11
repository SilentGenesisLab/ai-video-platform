export async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(method === "POST" ? { "Idempotency-Key": crypto.randomUUID() } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const data = await response.json();
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("请登录");
  }
  if (!response.ok) throw new Error(data.error?.message ?? "请求失败");
  return data;
}
export type Item = {
  id: string;
  kind: string;
  title: string;
  productId?: string;
  planId?: string;
  parentId?: string;
  version: number;
  status: string;
  content: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  [key: string]: any;
};
export const labels: Record<string, string> = {
  draft: "草稿",
  selected: "已入选",
  rejected: "已淘汰",
  archived: "已归档",
  ready: "已就绪",
  pending_approval: "待审批",
  queued: "排队中",
  submitting: "提交中",
  submission_unknown: "提交待确认",
  running: "制作中",
  processing: "制作中",
  transferring: "转存中",
  transfer_failed: "转存失败",
  succeeded: "已完成",
  completed: "已完成",
  partial_success: "部分完成",
  failed: "失败",
  cancelled: "已取消",
  needs_attention: "需要处理",
  paused: "已暂停",
  stopped: "已停止",
  pending: "待处理",
};
