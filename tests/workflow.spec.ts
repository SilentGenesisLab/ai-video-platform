import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const prefix = `浏览器验收 · E2E ${Date.now()}`;
let resources: { route: string; id: string }[] = [];
let keys: string[] = [];
let channels: any[] = [];
let members: string[] = [];
let batches: string[] = [];
const errors = new WeakMap<Page, string[]>();
async function viewerFixture(
  page: Page,
  input: { email: string; name: string; password: string; role: string },
) {
  expect(new URL(process.env.DATABASE_URL!).hostname).toBe("127.0.0.1");
  const actor = await data(page, "/auth/me");
  const user = await db.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await bcrypt.hash(input.password, 12),
      role: input.role,
    },
  });
  await db.teamMember.create({
    data: { teamId: actor.teamId, userId: user.id, role: input.role },
  });
  return user;
}

async function call(page: Page, path: string, method = "GET", data?: unknown) {
  return page.request.fetch(`/api/v1${path}`, {
    method,
    data,
    headers: { Origin: process.env.APP_URL!, "Idempotency-Key": randomUUID() },
  });
}
async function data(page: Page, path: string, method = "GET", body?: unknown) {
  const r = await call(page, path, method, body);
  expect(r.ok(), `${method} ${path}: ${r.status()}`).toBeTruthy();
  return r.json();
}
async function login(
  page: Page,
  email = process.env.ADMIN_EMAIL!,
  password = process.env.ADMIN_PASSWORD!,
) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "邮箱密码" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "产品管理." })).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
}
async function navigate(page: Page, name: string, tab?: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
  // Wait for the destination route, not the previous page's empty loading state.
  await expect(
    page.getByRole("heading", { name: name + ".", exact: true }),
  ).toBeVisible();
  if (tab)
    await page
      .locator(".tabs")
      .getByRole("button", { name: tab, exact: true })
      .click();
  await expect(page.locator(".loading")).toHaveCount(0);
}
async function seed(page: Page, route = "products", extra: any = {}) {
  const r = await data(page, "/" + route, "POST", {
    title: `${prefix} ${route} ${randomUUID().slice(0, 5)}`,
    content: {},
    ...extra,
  });
  resources.push({ route, id: r.id });
  return r;
}
async function edit(page: Page, item: any, section = "products") {
  if (section === "products") {
    await page.goto(`/studio/products/${item.id}`);
    await expect(page.getByLabel("产品名称", { exact: true })).toBeVisible();
    return page.locator(".product-detail");
  }
  await page.goto(`/studio/${section}?id=${item.id}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  return page.getByRole("dialog");
}
async function save(page: Page, route: string, existing = false) {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/v1/${route}`) &&
      r.request().method() === (existing ? "PATCH" : "POST"),
  );
  if (route === "products")
    await page.getByRole("button", { name: "保存产品", exact: true }).click();
  else
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name: existing ? "保存修订" : "保存",
        exact: true,
      })
      .click();
  const r = await response;
  expect(r.ok(), `save ${route}: ${r.status()}`).toBeTruthy();
  const body = await r.json();
  if (!existing) resources.push({ route, id: body.id });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (route === "products") {
    await expect(
      page.getByText("所有修改已保存", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "全部产品", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "产品管理." }),
    ).toBeVisible();
  }
  return body;
}
async function createUI(page: Page, button: string, title: string) {
  await page.getByRole("button", { name: button, exact: true }).click();
  const d =
    button === "新建产品"
      ? page.locator(".product-detail")
      : page.getByRole("dialog");
  await d
    .getByLabel(button === "新建产品" ? "产品名称" : "名称", { exact: true })
    .fill(title);
  return d;
}

test.beforeEach(async ({ page }) => {
  resources = [];
  keys = [];
  channels = [];
  members = [];
  batches = [];
  errors.set(page, []);
  page.on("pageerror", (e) => errors.get(page)!.push(e.message));
  await login(page);
});
test.afterEach(async ({ page }) => {
  // Clean up only objects created by this test. Retain immutable audit history.
  await call(page, "/auth/login", "POST", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  for (const id of batches) {
    const b = await data(page, `/production-batches/${id}`);
    if (b.status === "pending_approval")
      await data(page, `/approvals/${id}`, "POST", {
        digest: b.digest,
        decision: "reject",
      });
  }
  for (const id of keys) await call(page, `/api-keys/${id}`, "DELETE");
  for (const c of channels)
    await data(page, `/channels/${c.id}`, "PATCH", { ...c, enabled: false });
  for (const id of members)
    await db.user.update({ where: { id }, data: { active: false } });
  for (const r of resources.reverse()) {
    const item = await data(page, `/${r.route}/${r.id}`);
    if (item.status !== "archived")
      await data(page, `/${r.route}/${r.id}`, "PATCH", {
        title: item.title,
        content: item.content,
        baseVersion: item.version,
        status: "archived",
      });
  }
  expect(errors.get(page), "Browser uncaught exceptions").toEqual([]);
});

test("AUTH-01 wrong password, successful login, logout and protected route", async ({
  page,
}) => {
  const email = `e2e-login-${randomUUID()}@example.test`;
  const member = await viewerFixture(page, {
    email,
    name: prefix + " login validation",
    password: randomUUID(),
    role: "viewer",
  });
  members.push(member.id);
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("tab", { name: "邮箱密码" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page
    .getByLabel("密码", { exact: true })
    .fill("wrong-password-test-only");
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.locator("form [role=alert]")).toContainText(
    "账号或密码错误",
  );
  await login(page);
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/studio/products", { waitUntil: "commit" });
  await expect(page).toHaveURL(/\/login$/);
});

test("AUTH-02 email case and surrounding whitespace are normalized", async ({
  page,
}) => {
  const r = await call(page, "/auth/login", "POST", {
    email: `  ${process.env.ADMIN_EMAIL!.toUpperCase()}  `,
    password: process.env.ADMIN_PASSWORD,
  });
  expect(r.status()).toBe(200);
});

test("FORM-01 structured selling points preserve order and multiline details", async ({
  page,
}) => {
  const d = await createUI(page, "新建产品", prefix + " structured");
  await d.getByRole("button", { name: "产品洞察", exact: true }).click();
  await d.getByRole("button", { name: "添加卖点", exact: true }).click();
  await d.getByLabel("卖点标题", { exact: true }).fill("first");
  await d.getByLabel("用户收益", { exact: true }).fill("line one\nline two");
  await d.getByRole("button", { name: "添加卖点", exact: true }).click();
  await d.getByLabel("卖点标题", { exact: true }).nth(1).fill("second");
  await d.getByRole("button", { name: "上移卖点", exact: true }).nth(1).click();
  const product = await save(page, "products");
  expect(product.content.sellingPoints).toEqual(["second", "first"]);
  expect(product.content.sellingPointItems[1].benefit).toBe(
    "line one\nline two",
  );
});

test("FORM-02 fact editor distinguishes fact and hypothesis without JSON", async ({
  page,
}) => {
  const d = await createUI(page, "新建产品", prefix + " evidence");
  await d.getByRole("button", { name: "产品洞察", exact: true }).click();
  await d.getByRole("button", { name: "添加事实或假设", exact: true }).click();
  await d.getByLabel("内容", { exact: true }).fill("Verified fact");
  await d.getByLabel("证据状态", { exact: true }).selectOption("fact");
  const product = await save(page, "products");
  expect(product.content.facts[0].kind).toBe("fact");
  expect(product.content.facts[0].id).toBeTruthy();
});

test("BOARD-01 deleting then adding a shot never duplicates its number", async ({
  page,
}) => {
  const p = await seed(page);
  const plan = await seed(page, "plans", { productId: p.id });
  await navigate(page, "创意策划", "工业分镜");
  const d = await createUI(page, "新建工业分镜", prefix + " board");
  await d.getByLabel("所属产品").selectOption(p.id);
  await d.getByLabel("关联策划案").selectOption(plan.id);
  await d.getByRole("button", { name: "添加镜头" }).click();
  await d.getByRole("button", { name: "添加镜头" }).click();
  await d.locator(".shot-row").first().locator("summary").click();
  await d
    .locator(".shot-row")
    .first()
    .getByRole("button", { name: "移除此镜头" })
    .click();
  await d.getByRole("button", { name: "添加镜头" }).click();
  const numbers = await d.locator(".shot-row summary b").allTextContents();
  expect(new Set(numbers).size).toBe(numbers.length);
  await save(page, "storyboards");
});

test("PRODUCT-01 product history, version conflict and archive", async ({
  page,
}) => {
  const p = await seed(page);
  const d = await edit(page, p);
  await d
    .getByLabel("产品描述", { exact: true })
    .fill("human draft retained on conflict");
  await data(page, `/products/${p.id}`, "PATCH", {
    title: p.title,
    baseVersion: p.version,
    content: { brief: "Changed by another editor" },
  });
  await d.getByRole("button", { name: "保存产品", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(d.getByLabel("产品描述", { exact: true })).toHaveValue(
    "human draft retained on conflict",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await d
    .getByRole("button", { name: "放弃草稿并重新加载", exact: true })
    .click();
  await d.getByRole("button", { name: "历史版本", exact: true }).click();
  await expect(page.locator(".pd-history-revision")).toHaveCount(2);
  await page.getByRole("button", { name: "关闭历史版本" }).click();
  await d.getByLabel("产品状态", { exact: true }).selectOption("archived");
  await save(page, "products", true);
  await page.getByLabel("已归档", { exact: true }).check();
  await page.getByLabel("搜索", { exact: true }).fill(p.title);
  await expect(
    page.locator(".resource-card").filter({ hasText: p.title }),
  ).toHaveCount(1);
});

test("FLOW-01 product to creative, plan, storyboard, asset, script and video rejection", async ({
  page,
}) => {
  let d = await createUI(page, "新建产品", prefix + " workflow");
  await d.getByLabel("产品描述").fill("A test desk lamp; claims are fixtures");
  await d.getByRole("button", { name: "产品 Brief", exact: true }).click();
  await d
    .getByLabel("产品 Brief Markdown")
    .fill("# Brief\nMake a 5 second demonstration.");
  const p = await save(page, "products");
  await page
    .locator(".resource-card")
    .filter({ hasText: p.title })
    .getByRole("button", { name: "开始策划" })
    .click();
  await expect(page.getByLabel("按产品筛选")).toHaveValue(p.id);
  await page.getByRole("button", { name: "创意批次", exact: true }).click();
  d = await createUI(page, "新建创意批次", prefix + " ideas");
  await d.getByLabel("创作要求").fill("Show the actual use case");
  const batch = await save(page, "creative-batches");
  await page.getByRole("button", { name: "创意池", exact: true }).click();
  d = await createUI(page, "新建创意", prefix + " concept");
  await d.getByLabel("来源创意批次 ID").fill(batch.id);
  for (const label of [
    "开场钩子",
    "一句话创意",
    "叙述结构",
    "情绪曲线",
    "自评理由",
  ])
    await d.getByLabel(label, { exact: true }).fill(label + " test");
  await d.getByLabel("人工评分（0–10）").fill("8");
  await d.getByLabel("状态", { exact: true }).selectOption("selected");
  const concept = await save(page, "concepts");
  await page.getByRole("button", { name: "策划案", exact: true }).click();
  d = await createUI(page, "新建策划案", prefix + " plan");
  await d.getByLabel("来源创意 ID").fill(concept.id);
  await d
    .getByLabel("策划正文 · Markdown")
    .fill("Show product in use, then reveal details.");
  const plan = await save(page, "plans");
  await page
    .locator(".resource-card")
    .filter({ hasText: plan.title })
    .getByRole("button", { name: "查看分镜" })
    .click();
  d = await createUI(page, "新建工业分镜", prefix + " board");
  await d.getByLabel("关联策划案").selectOption(plan.id);
  await d.getByRole("button", { name: "添加镜头" }).click();
  await d
    .locator(".shot-row")
    .getByLabel("产品描述", { exact: true })
    .fill("Close-up of the lamp turning on");
  const board = await save(page, "storyboards");
  await navigate(page, "资产制作");
  d = await createUI(page, "新建资产", prefix + " asset");
  await d.getByLabel("所属产品").selectOption(p.id);
  await d.getByLabel("关联策划案").selectOption(plan.id);
  await d.getByLabel("资产分类").selectOption("product");
  await d.getByLabel("制作提示词").fill("A single consistent desk lamp");
  const asset = await save(page, "assets");
  await navigate(page, "视频制作", "制作脚本");
  d = await createUI(page, "新建脚本", prefix + " script");
  await d.getByLabel("所属产品").selectOption(p.id);
  await d.getByLabel("关联策划案").selectOption(plan.id);
  await d
    .getByLabel("制作提示词")
    .fill("Slow camera push towards the desk lamp");
  await d.getByLabel("覆盖镜头 ID（每行一个）").fill(board.content.shots[0].id);
  await d
    .getByLabel("资产版本引用")
    .fill(JSON.stringify([{ resourceId: asset.id, version: asset.version }]));
  const script = await save(page, "scripts");
  await page.getByRole("button", { name: "提交制作", exact: true }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("制作类型").selectOption("video");
  await d.getByLabel("批次名称").fill(prefix + " approval");
  await d.getByLabel("产品", { exact: true }).selectOption(p.id);
  await d.getByLabel("策划案", { exact: true }).selectOption(plan.id);
  await d.getByLabel("制作提示词").fill(script.content.prompt);
  await d.getByLabel("关联资产 / 分镜 / 脚本 ID").fill(script.id);
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/production-batches") &&
      r.request().method() === "POST",
  );
  await d.getByRole("button", { name: "获取积分报价", exact: true }).click();
  await d
    .getByRole("button", { name: "确认报价并提交审批", exact: true })
    .click();
  const b = await (await created).json();
  batches.push(b.id);
  expect(b.status).toBe("pending_approval");
  await expect(d).toHaveCount(0);
  await page.getByRole("button", { name: "制作批次", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: prefix + " approval" })
    .getByRole("button", { name: "查看审批" })
    .click();
  await expect(page.getByRole("button", { name: "批准本批次" })).toBeVisible();
  await page.getByRole("button", { name: "拒绝", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const rejected = await data(page, `/production-batches/${b.id}`);
  expect(rejected.status).toBe("rejected");
  expect(rejected.jobs).toHaveLength(0);
});

test("FILE-01 upload text, extraction, file ID and product version", async ({
  page,
}) => {
  const p = await seed(page);
  await page.reload();
  await page
    .locator(".resource-card")
    .filter({ hasText: p.title })
    .getByRole("button", { name: "产品资料" })
    .click();
  await page.getByRole("button", { name: "产品素材", exact: true }).click();
  const d = page.locator(".product-detail");
  await d.getByLabel("上传产品素材文件").setInputFiles({
    name: "brief-e2e.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Verified E2E product source text"),
  });
  await expect(
    d.getByText("已上传，请保存产品关联", { exact: true }),
  ).toBeVisible();
  await save(page, "products", true);
  const latest = await data(page, `/products/${p.id}`);
  expect(latest.version).toBe(p.version + 1);
  expect(latest.content.fileIds).toHaveLength(1);
  await expect
    .poll(
      async () =>
        (await data(page, `/files/${latest.content.fileIds[0]}`)).parseStatus,
      { timeout: 30000 },
    )
    .toBe("completed");
});

test("FILE-02 silent video upload, playback, delivery and incomplete lineage", async ({
  page,
}) => {
  mkdirSync(".runtime", { recursive: true });
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=320x180:d=1",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    ".runtime/e2e-silent.mp4",
  ]);
  const p = await seed(page);
  const plan = await seed(page, "plans", { productId: p.id });
  await page.reload();
  await page
    .locator(".resource-card")
    .filter({ hasText: p.title })
    .getByRole("button", { name: "产品资料" })
    .click();
  await page.getByRole("button", { name: "产品素材", exact: true }).click();
  await page.getByLabel("上传产品素材文件").setInputFiles({
    name: "silent-e2e.mp4",
    mimeType: "video/mp4",
    buffer: readFileSync(".runtime/e2e-silent.mp4"),
  });
  await expect(
    page.getByText("已上传，请保存产品关联", { exact: true }),
  ).toBeVisible();
  await save(page, "products", true);
  const latest = await data(page, `/products/${p.id}`);
  const fileId = latest.content.fileIds[0];
  await expect
    .poll(async () => (await data(page, `/files/${fileId}`)).parseStatus, {
      timeout: 30000,
    })
    .toBe("completed");
  await navigate(page, "视频制作", "成片交付");
  const d = await createUI(page, "新建成片", prefix + " delivery");
  await d.getByLabel("所属产品").selectOption(p.id);
  await d.getByLabel("关联策划案").selectOption(plan.id);
  await d.getByLabel("成片文件 ID").fill(fileId);
  const delivery = await save(page, "deliverables");
  const card = page
    .locator(".resource-card")
    .filter({ hasText: delivery.title });
  await expect(card.getByText("追溯信息不完整")).toBeVisible();
  const video = card.locator("video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThan(0);
  await video.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const file = await data(page, `/files/${fileId}`);
  expect((await page.request.get(file.url)).status()).toBe(200);
});

test("SEARCH-01 older records remain reachable through search and pagination", async ({
  page,
}) => {
  const p = await seed(page);
  let first: any;
  for (let i = 0; i < 31; i++) {
    const c = await seed(page, "concepts", {
      productId: p.id,
      title: `${prefix} page ${i}`,
    });
    if (!i) first = c;
  }
  await navigate(page, "创意策划");
  await page.getByLabel("按产品筛选").selectOption(p.id);
  await expect(page.locator(".resource-card")).toHaveCount(30);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.locator(".resource-card")).toHaveCount(1);
  await expect(page.locator(".resource-card")).toContainText(first.title);
  await page.getByLabel("搜索", { exact: true }).fill(first.title);
  await expect(page.locator(".resource-card")).toHaveCount(1);
  await expect(page.locator(".resource-card")).toContainText(first.title);
});

test("BOARD-02 10-shot overview yields two pages and retains input revision", async ({
  page,
}) => {
  const p = await seed(page);
  const plan = await seed(page, "plans", { productId: p.id });
  const b = await seed(page, "storyboards", {
    productId: p.id,
    planId: plan.id,
    content: {
      shots: Array.from({ length: 10 }, (_, i) => ({
        id: randomUUID(),
        number: i + 1,
        duration: 5,
        description: `shot ${i + 1}`,
      })),
    },
  });
  await navigate(page, "创意策划", "工业分镜");
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/storyboards/${b.id}/overview`) &&
      r.request().method() === "POST",
  );
  await page
    .locator(".resource-card")
    .filter({ hasText: b.title })
    .getByRole("button", { name: "拼接总览" })
    .click();
  const job = await (await response).json();
  await expect
    .poll(async () => (await data(page, `/jobs/${job.id}`)).status, {
      timeout: 45000,
    })
    .toBe("succeeded");
  const done = await data(page, `/jobs/${job.id}`);
  expect(done.result.files).toHaveLength(2);
  expect(done.result.source.version).toBe(b.version);
  await navigate(page, "日志状态");
  await page.getByLabel("按产品筛选").selectOption(p.id);
  await page
    .getByRole("row")
    .filter({ hasText: job.id.slice(0, 8) })
    .getByRole("button")
    .click();
  await expect(
    page.getByRole("dialog").locator(".file-preview img"),
  ).toHaveCount(2);
});

test("GEN-01 switching channel uses that channel's supported model", async ({
  page,
}) => {
  const p = await seed(page);
  const c = await data(page, "/channels", "POST", {
    name: prefix + " isolated-model",
    provider: "aicentre",
    baseUrl: "https://e2e.invalid",
    apiKey: "fixture-not-real",
    enabled: true,
    concurrency: 1,
    models: { image: ["custom-image-fixture"] },
  });
  channels.push(c);
  await navigate(page, "资产制作");
  await page.getByRole("button", { name: "提交制作", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("产品", { exact: true }).selectOption(p.id);
  await d.getByLabel("生成渠道").selectOption(c.id);
  await expect(d.getByLabel("模型", { exact: true })).toHaveValue(
    "custom-image-fixture",
  );
  await d.getByLabel("制作类型").selectOption("audio");
  await d.getByLabel("制作提示词").fill("Do not submit this fixture");
  await expect(d.getByRole("button", { name: "获取积分报价" })).toBeDisabled();
  await d.getByRole("button", { name: "取消", exact: true }).click();
});

test("AUTH-03 email login, password visibility and network failure recovery", async ({
  page,
}) => {
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("tab", { name: "邮箱密码" }).click();
  const password = page.locator('input[name="password"]');
  await page.getByRole("button", { name: "显示密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "隐藏密码", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await page.route("**/api/v1/auth/login", (r) =>
    r.fulfill({ status: 502, contentType: "text/html", body: "Bad gateway" }),
  );
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.ADMIN_EMAIL!);
  await password.fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.locator("form [role=alert]")).toContainText(
    "登录服务暂时不可用",
  );
  await expect(page.getByRole("button", { name: "进入工作台" })).toBeEnabled();
  await page.unroute("**/api/v1/auth/login");
  await login(page);
});

test("CHAT-01 live Agent reads product and persists conversation after reload", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_LIVE_AGENT !== "1",
    "Opt in to one real text-model read-only task",
  );
  test.setTimeout(150000);
  const p = await seed(page);
  await page.goto(`/studio/creative?productId=${p.id}`);
  await expect(page.getByLabel("按产品筛选")).toHaveValue(p.id);
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await page
    .getByLabel("发送给创作搭档")
    .fill(
      "这是只读验收。请调用工具读取当前产品，仅回复产品名称。禁止修改内容，禁止提交任何图片、视频或音乐生成任务。",
    );
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".run-status")).toContainText("已完成", {
    timeout: 110000,
  });
  await expect(page.locator(".message.assistant").last()).toContainText(
    p.title,
  );
  await page.reload();
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await expect(page.locator(".message.assistant").last()).toContainText(
    p.title,
  );
  expect((await data(page, `/jobs?productId=${p.id}`)).items).toHaveLength(0);
});

test("KEY-01 create, scope, copy, disable, rotate and revoke", async ({
  page,
}) => {
  const p = await seed(page);
  await navigate(page, "Agent 接入");
  await page.getByRole("button", { name: "创建 API Key" }).click();
  let d = page.getByRole("dialog");
  const name = prefix + " key";
  await d.getByLabel("名称", { exact: true }).fill(name);
  await d.getByLabel("编辑创作").uncheck();
  await d.getByLabel("提交生成").uncheck();
  await d.getByLabel(p.title, { exact: true }).check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api-keys") && r.request().method() === "POST",
  );
  await d.getByRole("button", { name: "保存密钥" }).click();
  const k = await (await response).json();
  keys.push(k.id);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  const instruction = await data(
    page,
    `/api-keys/${k.id}/connection-instructions`,
    "POST",
    {},
  );
  const token = /AIVIDEO_API_KEY=(\S+)/.exec(instruction.instructions)![1];
  const agent = (path: string) =>
    page.request.get(`/api/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  expect((await agent("/auth/me")).status()).toBe(200);
  expect((await agent("/api-keys")).status()).toBe(403);
  // Clipboard is tested without attaching the secret or its response to the report.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => {} },
      configurable: true,
    });
  });
  await row.getByRole("button", { name: "接入指令", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已复制");
  await row.getByRole("button", { name: /编辑/ }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("启用密钥").uncheck();
  await d.getByRole("button", { name: "保存密钥" }).click();
  await expect.poll(async () => (await agent("/auth/me")).status()).toBe(401);
  await row.getByRole("button", { name: /编辑/ }).click();
  await page.getByRole("dialog").getByLabel("启用密钥").check();
  await page.getByRole("button", { name: "保存密钥" }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: /轮换/ }).click();
  await expect.poll(async () => (await agent("/auth/me")).status()).toBe(401);
  await row.getByRole("button", { name: /撤销/ }).click();
  await expect(row).toHaveCount(0);
});

test("CHANNEL-01 create and disable isolated channel, invalid JSON blocks save", async ({
  page,
}) => {
  await navigate(page, "渠道管理");
  await page.getByRole("button", { name: "添加渠道" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("名称", { exact: true }).fill(prefix + " channel");
  await d.getByLabel("接口地址").fill("https://e2e.invalid");
  await d.getByLabel("供应商 API Key").fill("fixture-not-a-real-key");
  await d.getByLabel("启用渠道").uncheck();
  await d.getByLabel("能力与模型列表").fill("{invalid");
  await expect(d.getByRole("button", { name: "保存配置" })).toBeDisabled();
  await d.getByLabel("能力与模型列表").fill('{"image":["gpt-image-2.5"]}');
  const result = page.waitForResponse(
    (r) => r.url().endsWith("/channels") && r.request().method() === "POST",
  );
  await d.getByRole("button", { name: "保存配置" }).click();
  const c = await (await result).json();
  channels.push(c);
  await expect(d).toHaveCount(0);
  expect(c.enabled).toBe(false);
  expect(c.configured).toBe(true);
  expect(c.ciphertext).toBeUndefined();
});

test("ROLE-01 viewer reads resources without edit or generation controls", async ({
  page,
  browser,
}) => {
  const p = await seed(page);
  const password = randomUUID() + "aA9!";
  const email = `e2e-${randomUUID()}@example.test`;
  const m = await viewerFixture(page, {
    email,
    name: prefix + " viewer",
    password,
    role: "viewer",
  });
  members.push(m.id);
  const ctx = await browser.newContext({ baseURL: process.env.APP_URL });
  const viewer = await ctx.newPage();
  try {
    await login(viewer, email, password);
    await expect(
      viewer.getByRole("button", { name: "新建产品", exact: true }),
    ).toHaveCount(0);
    const d = await edit(viewer, p);
    await expect(d.getByRole("button", { name: /^保存/ })).toHaveCount(0);
    await expect(d.getByLabel("产品描述")).toHaveAttribute("readonly", "");
    await d.getByRole("button", { name: "全部产品", exact: true }).click();
    await navigate(viewer, "资产制作");
    await expect(
      viewer.getByRole("button", { name: "提交制作", exact: true }),
    ).toHaveCount(0);
    await viewer.getByRole("button", { name: "创作搭档", exact: true }).click();
    await expect(viewer.getByLabel("发送给创作搭档")).toBeDisabled();
    expect(
      (
        await call(viewer, "/products", "POST", {
          title: "forbidden",
          content: {},
        })
      ).status(),
    ).toBe(403);
  } finally {
    await ctx.close();
  }
});

test("CHAT-02 polling failure is visible and recovers without uncaught errors", async ({
  page,
}) => {
  const p = await seed(page);
  const c = await data(page, "/conversations", "POST", {
    title: prefix + " polling",
    productId: p.id,
  });
  await page.goto(`/studio/creative?productId=${p.id}`);
  await expect(page.getByLabel("按产品筛选")).toHaveValue(p.id);
  await page.route(`**/api/v1/conversations/${c.id}`, (r) =>
    r.fulfill({
      status: 503,
      json: { error: { message: "会话读取暂时不可用" } },
    }),
  );
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("会话读取暂时不可用");
  await page.unroute(`**/api/v1/conversations/${c.id}`);
  const recovered = page.waitForResponse(
    (r) => r.url().endsWith(`/conversations/${c.id}`) && r.status() === 200,
  );
  await recovered;
  await expect(page.getByLabel("发送给创作搭档")).toBeEnabled();
});

test("NAV-01 seven modules, logs, chat context and mobile navigation", async ({
  page,
}) => {
  for (const name of [
    "创意策划",
    "资产制作",
    "视频制作",
    "渠道管理",
    "日志状态",
    "Agent 接入",
    "产品管理",
  ]) {
    await navigate(page, name);
    await expect(page.getByRole("heading", { name: name + "." })).toBeVisible();
  }
  await navigate(page, "日志状态", "操作留痕");
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await expect(page.getByPlaceholder("描述你的想法…")).toBeVisible();
  await page.getByRole("button", { name: "关闭聊天" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ["产品管理", "创意策划", "Agent 接入", "日志状态"]) {
    await navigate(page, name);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
