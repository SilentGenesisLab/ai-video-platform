import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "邮箱密码" }).click();
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
  const startingBalance = Number((await api(page, "/billing/wallet")).balance);
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await page
    .getByLabel("发送给创作搭档")
    .fill(
      "这是流式输出验收。不要调用任何工具，不要生成媒体。请写一份约800字的创意工作习惯建议，分成12条，每条包含具体做法。",
    );
  await page.getByLabel("发送给创作搭档").press("Enter");
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
  expect(Number((await api(page, "/billing/wallet")).balance)).toBe(
    startingBalance,
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

test("ASSISTANT-04 composer changes from send to pause and hides run status", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__assistantStream = null;
    (window as any).EventSource = class {
      listeners: Record<string, any> = {};
      constructor() {
        (window as any).__assistantStream = this;
      }
      addEventListener(name: string, listener: any) {
        this.listeners[name] = listener;
      }
      close() {}
    };
  });
  await page.route("**/api/v1/conversations", async (route) =>
    route.fulfill({
      json: { items: [{ id: "pause-fixture", title: "暂停按钮验收" }] },
    }),
  );
  await page.route("**/api/v1/conversations/pause-fixture", async (route) =>
    route.fulfill({
      json: {
        id: "pause-fixture",
        title: "暂停按钮验收",
        cursor: "0",
        messages: [],
        runs: [{ id: "pause-run", status: "running" }],
      },
    }),
  );
  let stops = 0;
  await page.route("**/api/v1/agent-runs/pause-run/stop", async (route) => {
    stops++;
    await route.fulfill({ json: { status: "stopped" } });
    await page.evaluate(() =>
      (window as any).__assistantStream.listeners.update({
        data: JSON.stringify({
          seq: "1",
          type: "run",
          runId: "pause-run",
          data: { status: "stopped" },
        }),
      }),
    );
  });
  await login(page);
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "创意助手" });
  await expect(panel.locator(".run-status")).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "暂停生成", exact: true }),
  ).toBeEnabled();
  await expect(
    panel.getByRole("button", { name: "停止", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as any).__assistantStream?.listeners.update),
      ),
    )
    .toBeTruthy();
  await panel.getByRole("button", { name: "暂停生成", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeVisible();
  expect(stops).toBe(1);
  await panel.getByLabel("发送给创作搭档").fill("保留暂停后的草稿");
  await expect(
    panel.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeEnabled();
});

test("ASSISTANT-05 Shift+Enter and IME preserve draft without sending", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  const composer = page.getByLabel("发送给创作搭档");
  let sends = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /conversations\/[^/]+\/messages$/.test(request.url())
    )
      sends++;
  });
  await composer.fill("第一行");
  await composer.press("Shift+Enter");
  await composer.press("a");
  await expect(composer).toHaveValue("第一行\na");
  await composer.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(composer).toHaveValue("第一行\na");
  expect(sends).toBe(0);
});

test("ASSISTANT-06 AI collaboration adds removable persistent resource context", async ({
  page,
}) => {
  test.skip(
    !process.env.APP_URL?.includes("127.0.0.1"),
    "Local resource fixtures only",
  );
  await login(page);
  const product = await api(page, "/products", {
    title: "引用验收 " + randomUUID(),
    content: { description: "引用的产品说明" },
  });
  await page.reload();
  const card = page
    .locator(".resource-card")
    .filter({ hasText: product.title });
  await card.getByRole("button", { name: "AI 协作", exact: true }).click();
  const context = page.getByLabel("编辑上下文");
  await expect(context).toContainText(product.title);
  await page.getByLabel("发送给创作搭档").fill("修改这个产品描述");
  await page.reload();
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await expect(context).toContainText(product.title);
  let sent: any;
  await page.route("**/api/v1/conversations/*/messages", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { id: "mock-run", status: "queued" } });
  });
  await page.getByLabel("发送给创作搭档").press("Enter");
  await expect.poll(() => sent?.referenceIds).toEqual([product.id]);
  await expect(context.locator(".assistant-reference")).toHaveCount(0);
  await card.getByRole("button", { name: "AI 协作", exact: true }).click();
  await expect(context).toContainText(product.title);
  await context.getByLabel("移除引用 " + product.title).click();
  await expect(context.locator(".assistant-reference")).toHaveCount(0);
});

test("ASSISTANT-07 media placeholders update to results without resubmission", async ({
  page,
}) => {
  await login(page);
  const c = await api(page, "/conversations", {
    title: "卡片验收 " + randomUUID(),
  });
  let completed = false,
    reads = 0;
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTH4AAAAASUVORK5CYII=";
  await page.route(`**/api/v1/conversations/${c.id}/media`, async (route) => {
    reads++;
    await route.fulfill({
      json: {
        items: [
          {
            id: "image-fixture",
            title: "生成的图片",
            kind: "image",
            count: 1,
            status: completed ? "succeeded" : "queued",
            jobs: [
              {
                id: "image-job",
                status: completed ? "succeeded" : "queued",
                files: completed
                  ? [{ id: "result", mime: "image/png", url: png }]
                  : [],
              },
            ],
          },
          {
            id: "video-fixture",
            title: "待审批视频",
            kind: "video",
            count: 2,
            status: "pending_approval",
            jobs: [],
          },
        ],
      },
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  const image = page.locator('[data-batch-id="image-fixture"]');
  await expect(image.locator(".assistant-media-placeholder")).toBeVisible();
  await expect(page.locator('[data-batch-id="video-fixture"]')).toContainText(
    "等待人工审批",
  );
  completed = true;
  await expect(image.getByRole("img", { name: "生成的图片" })).toBeVisible({
    timeout: 10000,
  });
  await expect(image.locator(".assistant-media-placeholder")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await expect(image.getByRole("img", { name: "生成的图片" })).toBeVisible();
  expect(reads).toBeGreaterThan(1);
});


test("ASSISTANT-08 live Agent edits selected concept instead of creating a copy",async({page})=>{
  test.skip(process.env.E2E_LIVE_AGENT !== "1" || !process.env.APP_URL?.includes("127.0.0.1"),"Explicit local real model editing test");
  await login(page);
  const p=await api(page,"/products",{title:"编辑验收 "+randomUUID(),content:{}});
  const ref=await api(page,"/concepts",{title:"引用目标",productId:p.id,content:{hook:"原钩子",idea:"保留的一句话创意",structure:"保留的结构",emotion:"保留的情绪",selfReview:"保留的评审"}});
  const c=await api(page,"/conversations",{title:"定向修改验收",productId:p.id});
  await api(page,`/conversations/${c.id}/messages`,{text:"请使用API修改这次引用的创意：仅把 hook 字段改成 精准修改后的钩子，严格保留名称、其他字段和产品归属，通过PATCH保存新版本，不新建任何创意，不生成媒体，不搜索。",referenceIds:[ref.id]});
  await expect.poll(async()=> (await api(page,"/concepts/"+ref.id)).content.hook,{timeout:120000,intervals:[1000,2000]}).toBe("精准修改后的钩子");
  const latest=await api(page,"/concepts/"+ref.id);
  expect(latest.version).toBe(ref.version+1);
  expect(latest.content.idea).toBe(ref.content.idea);
  expect(latest.title).toBe(ref.title);
  const list=await api(page,"/concepts?productId="+p.id);
  expect(list.items).toHaveLength(1);
});
