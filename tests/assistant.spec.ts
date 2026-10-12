import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "产品管理." })).toBeVisible();
}
async function api(page: Page, path: string, body?: unknown) {
  const r = await page.request.fetch("/api/v1" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: process.env.APP_URL!, "Idempotency-Key": randomUUID() },
    data: body,
  });
  expect(r.ok(), `${path} ${r.status()}`).toBeTruthy();
  return r.json();
}
test("ASSISTANT-01 overlay does not reflow, resizes and retains draft across routes", async ({
  page,
}) => {
  await login(page);
  const mainGeometry = async () => {
    const b = await page.locator("main.main").boundingBox();
    return { x: b!.x, y: b!.y, width: b!.width };
  };
  const before = await mainGeometry();
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "创意助手" });
  await expect(panel).toBeVisible();
  expect(await mainGeometry()).toEqual(before);
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await page.getByLabel("发送给创作搭档").fill("保留跨页面草稿");
  const edge = await page
    .getByRole("separator", { name: "调整助手宽度" })
    .boundingBox();
  await page.mouse.move(edge!.x + 5, edge!.y + 120);
  await page.mouse.down();
  await page.mouse.move(edge!.x - 100, edge!.y + 120, { steps: 5 });
  await page.mouse.up();
  const expanded = await panel.boundingBox();
  expect(expanded!.width).toBeGreaterThan(590);
  expect(await mainGeometry()).toEqual(before);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "创意策划", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "创意策划." })).toBeVisible();
  await expect(page.getByLabel("发送给创作搭档")).toHaveValue("保留跨页面草稿");
  await page.getByRole("button", { name: "关闭聊天" }).click();
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await expect(page.getByLabel("发送给创作搭档")).toHaveValue("保留跨页面草稿");
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeCloseTo(expanded!.width, 0);
  // No attachment or message has created a server conversation yet.
  await page.reload();
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await expect(page.getByLabel("发送给创作搭档")).toHaveValue("保留跨页面草稿");
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeCloseTo(expanded!.width, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await panel.boundingBox())!.width).toBe(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("ASSISTANT-02 unbound upload is deferred, removable and persists after refresh", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  const name = "助手验收-" + randomUUID() + ".txt";
  await page.getByLabel("上传聊天附件").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(
      "这是一份待发送的产品说明，没有点击发送就不能开始模型解析。",
    ),
  });
  const card = page
    .locator(".assistant-drafts .assistant-file")
    .filter({ hasText: name });
  await expect(card).toContainText("发送后分析", { timeout: 30000 });
  const id = await card.getAttribute("data-file-id");
  const f = await api(page, "/files/" + id);
  expect(f.productId).toBeNull();
  expect(f.conversationId).toBeTruthy();
  expect(f.parseStatus).toBe("deferred");
  await page.getByLabel("发送给创作搭档").fill("待发送内容");
  await page.reload();
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await expect(page.getByLabel("发送给创作搭档")).toHaveValue("待发送内容");
  await expect(card).toContainText(name);
  await page.getByRole("button", { name: "移除 " + name }).click();
  await expect(card).toHaveCount(0);
  expect((await api(page, "/files/" + id)).parseStatus).toBe("deferred");
});
test("ASSISTANT-03 live SSE yields multiple visible deltas before completion", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Explicit text-model verification",
  );
  await page.addInitScript(() => {
    const Native = window.EventSource;
    (window as any).__assistantEvents = [];
    window.EventSource = class extends Native {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        this.addEventListener("update", (e: MessageEvent) => {
          const event = JSON.parse(e.data);
          (window as any).__assistantEvents.push({
            type: event.type,
            time: Date.now(),
          });
        });
      }
    } as any;
  });
  await login(page);
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await page
    .getByLabel("发送给创作搭档")
    .fill(
      "这是流式输出验收。不要调用任何工具，不要生成媒体。请写一份约800字的创意工作习惯建议，分成12条，每条包含具体做法。",
    );
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as any).__assistantEvents.filter(
              (e: any) => e.type === "delta",
            ).length,
        ),
      { timeout: 60000 },
    )
    .toBeGreaterThan(1);
  await expect(
    page.locator(".assistant-panel .message.assistant").first(),
  ).not.toHaveText("");
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).__assistantEvents.some(
            (e: any) => e.type === "complete",
          ),
        ),
      { timeout: 60000 },
    )
    .toBe(true);
  const events = await page.evaluate(() => (window as any).__assistantEvents);
  expect(events.filter((e: any) => e.type === "delta").length).toBeGreaterThan(
    1,
  );
  expect(events.findIndex((e: any) => e.type === "delta")).toBeLessThan(
    events.findIndex((e: any) => e.type === "complete"),
  );
  const response = await page
    .locator(".assistant-panel .message.assistant")
    .last()
    .innerText();
  await page.reload();
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await expect(
    page.locator(".assistant-panel .message.assistant").last(),
  ).toHaveText(response);
});

test("ASSISTANT-04 attachment-only send parses before model and preserves original", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Explicit text-model verification",
  );
  await login(page);
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  const name = `发送验收-${randomUUID()}.txt`;
  await page.getByLabel("上传聊天附件").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(
      "验收材料：产品是一把蓝色折叠伞，产品代号 QX732。请只根据材料用一句话总结，不要联网或生成媒体。",
    ),
  });
  const card = page
    .locator(".assistant-drafts .assistant-file")
    .filter({ hasText: name });
  await expect(card).toContainText("发送后分析", { timeout: 30000 });
  const id = await card.getAttribute("data-file-id");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.locator(".assistant-panel .message.assistant").last(),
  ).toContainText("QX732", { timeout: 60000 });
  const file = await api(page, `/files/${id}`);
  expect(file.parseStatus).toBe("completed");
  expect(file.extractedText).toContain("QX732");
  expect(file.productId).toBeNull();
});
