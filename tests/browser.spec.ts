import { test, expect } from "@playwright/test";
import "dotenv/config";
test("human workspace, editing, key onboarding and responsive navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto((process.env.APP_URL ?? "http://127.0.0.1:3000") + "/login");
  await page.getByLabel("邮箱").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("密码").fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "产品管理." })).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.screenshot({
    path: ".runtime/workspace-desktop.png",
    fullPage: true,
  });
  const productTitle = "浏览器验收 · 桌面灯 " + Date.now();
  await page.getByRole("button", { name: "新建产品", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill(productTitle);
  await page.getByLabel("产品描述").fill("仅用于功能验收的示例资料");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: productTitle, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Agent 接入" })
    .click();
  await expect(
    page.getByRole("heading", { name: "复制一次，连接你的 Agent。" }),
  ).toBeVisible();
  const keyName = "浏览器验收 Agent " + Date.now();
  await page.getByRole("button", { name: "创建 API Key" }).click();
  await page.getByLabel("名称", { exact: true }).fill(keyName);
  await page.getByRole("button", { name: "保存密钥" }).click();
  await expect(page.getByText(keyName, { exact: true })).toBeVisible();
  await page.screenshot({ path: ".runtime/agent-access.png", fullPage: true });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "创意策划" })
    .click();
  await page.getByRole("button", { name: "工业分镜", exact: true }).click();
  await expect(page.getByRole("heading", { name: "创意策划." })).toBeVisible();
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await expect(page.getByPlaceholder("描述你的想法…")).toBeVisible();
  await page.getByRole("button", { name: "关闭聊天" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "产品管理" })
    .click();
  await expect(page.getByRole("heading", { name: "产品管理." })).toBeVisible();
  await expect(page.locator(".loading")).toHaveCount(0);
  await page.screenshot({
    path: ".runtime/workspace-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
