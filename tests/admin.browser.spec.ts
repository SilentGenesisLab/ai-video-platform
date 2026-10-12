import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function login(page: any) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "邮箱密码" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "产品管理." })).toBeVisible();
}
async function request(page: any, path: string, method = "GET", body?: any) {
  const r = await page.request.fetch("/api/v1" + path, {
    method,
    headers: { Origin: process.env.APP_URL!, "Idempotency-Key": randomUUID() },
    data: body,
  });
  expect(r.ok(), path + " " + (await r.text())).toBeTruthy();
  return r.json();
}
test("ADMIN-01 four modules, filters, defaults and mobile layout", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "管理后台", exact: true }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(
    page.getByRole("heading", { name: "数据看板", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "时间范围", exact: true })
    .selectOption("7");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page.getByRole("heading", { name: "费用与积分" })).toBeVisible();
  await page.getByRole("button", { name: "模型渠道", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "缺价默认收费" }),
  ).toBeVisible();
  await expect(page.getByLabel("每请求人民币金额")).toHaveValue("1");
  await page.getByRole("button", { name: "用户管理", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "用户管理", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "积分管理", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "团队分配给成员" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("ADMIN-02 account creation, credits, status and session invalidation", async ({
  page,
  browser,
}) => {
  test.skip(
    !process.env.APP_URL?.includes("127.0.0.1"),
    "Mutable account test uses local fixture database only",
  );
  await login(page);
  await page.goto("/admin");
  await page.getByRole("button", { name: "用户管理", exact: true }).click();
  await page.getByRole("button", { name: "创建用户", exact: true }).click();
  const email = `admin-e2e-${randomUUID()}@test.invalid`,
    password = "AdminFixture@2026";
  await page.getByLabel("用户姓名", { exact: true }).fill("后台验收用户");
  await page.getByLabel("用户邮箱", { exact: true }).fill(email);
  await page.getByLabel("初始密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "保存用户", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("用户已创建");
  const users = await request(
      page,
      "/platform/users?q=" + encodeURIComponent(email),
    ),
    user = users.items[0];
  expect(user).toBeTruthy();
  expect(
    Number((await request(page, `/platform/users/${user.id}`)).wallet.balance),
  ).toBe(20000);
  await request(page, "/platform/personal-credits", "POST", {
    userId: user.id,
    amount: 200,
    reason: "浏览器验收发放",
    eventKey: randomUUID(),
  });
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(process.env.APP_URL! + "/login");
  const response = await other.request.post(
    process.env.APP_URL! + "/api/v1/auth/login",
    { headers: { Origin: process.env.APP_URL! }, data: { email, password } },
  );
  expect(response.ok()).toBe(true);
  expect(
    (
      await other.request.get(process.env.APP_URL! + "/api/v1/billing/wallet")
    ).status(),
  ).toBe(200);
  const gifted = await (
    await other.request.get(process.env.APP_URL! + "/api/v1/billing/wallet")
  ).json();
  expect(Number(gifted.balance)).toBe(20200);
  expect(
    (
      await other.request.get(process.env.APP_URL! + "/api/v1/platform/users")
    ).status(),
  ).toBe(403);
  await request(page, `/platform/users/${user.id}/reset-password`, "POST", {
    password: "UpdatedFixture@2026",
  });
  expect(
    (
      await other.request.get(process.env.APP_URL! + "/api/v1/auth/me")
    ).status(),
  ).toBe(401);
  await page.getByLabel("搜索用户").fill(email);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: email });
  await row.getByRole("button", { name: "停用用户", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "启用用户", exact: true }),
  ).toBeVisible();
  await context.close();
});
test("ADMIN-03 channel configuration, immutable price and pool allocation", async ({
  page,
}) => {
  test.skip(!process.env.APP_URL?.includes("127.0.0.1"), "Local fixtures only");
  await login(page);
  await page.goto("/admin");
  const actor = await request(page, "/auth/me");
  await page.getByRole("button", { name: "模型渠道", exact: true }).click();
  await page.getByRole("button", { name: "新增渠道", exact: true }).click();
  const name = `后台渠道 ${randomUUID()}`;
  await page.getByLabel("渠道名称", { exact: true }).fill(name);
  await page
    .getByLabel("API地址", { exact: true })
    .fill("https://fixture.invalid");
  await page
    .getByLabel("供应商密钥", { exact: true })
    .fill("private-test-value");
  await page
    .locator('textarea[name="models"]')
    .fill('{"text":["fixture-text"]}');
  await page.getByRole("button", { name: "保存渠道", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  const channels = (await request(page, "/channels")).items;
  const channel = channels.find((c: any) => c.name === name);
  expect(channel).toBeTruthy();
  expect(JSON.stringify(channel)).not.toContain("private-test-value");
  const price = page.locator("form").filter({
    has: page.getByRole("heading", { name: "发布采购价版本", exact: true }),
  });
  await price.locator('select[name="channelId"]').selectOption(channel.id);
  await price.locator('select[name="unit"]').selectOption("token");
  await price.locator('input[name="rate"]').fill("0.5");
  await price.locator('input[name="inputRate"]').fill("0.1");
  await price.locator('input[name="cachedInputRate"]').fill("0.01");
  await price.locator('input[name="basis"]').fill("本地测试合同采购价");
  await price.getByRole("button", { name: "发布价格", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("价格");
  expect(
    (await request(page, "/platform/rates")).items.some(
      (r: any) => r.channelId === channel.id && Number(r.rate) === 0.5,
    ),
  ).toBe(true);
  await page
    .locator("article")
    .filter({ hasText: name })
    .getByRole("button", { name: "停用", exact: true })
    .click();
  await expect(
    page
      .locator("article")
      .filter({ hasText: name })
      .getByRole("button", { name: "启用", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "积分管理", exact: true }).click();
  const pool = page.locator("form").filter({
    has: page.getByRole("heading", { name: "调整团队公共池", exact: true }),
  });
  await pool.locator('select[name="teamId"]').selectOption(actor.teamId);
  await pool.locator('input[name="amount"]').fill("100");
  await pool.locator('input[name="reason"]').fill("浏览器分配测试");
  await pool
    .getByRole("button", { name: "确认调整团队积分", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("团队公共积分已调整");
  const before = await request(page, "/billing/wallet");
  const allocation = page.locator("form").filter({
    has: page.getByRole("heading", { name: "团队分配给成员", exact: true }),
  });
  await allocation.locator("select").first().selectOption(actor.teamId);
  await allocation.locator('select[name="userId"]').selectOption(actor.userId);
  await allocation.locator('input[name="amount"]').fill("100");
  await allocation.locator('input[name="reason"]').fill("浏览器分配测试");
  await allocation
    .getByRole("button", { name: "确认分配积分", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("积分已分配到个人余额");
  const after = await request(page, "/billing/wallet");
  expect(Number(after.balance) - Number(before.balance)).toBeCloseTo(100, 5);
});
