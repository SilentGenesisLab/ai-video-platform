import { systemDb as db } from "../src/lib/db";
import { test, expect } from "@playwright/test";
import { permissionIds, recommendedPermissions } from "../src/lib/permissions";
test("Key editor: permissions, dependencies, explicit range, paginated bulk selection, edit and mobile", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("tab", { name: "邮箱密码" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await expect(page).toHaveURL(/studio/, { timeout: 30000 });
  const prefix = `权限分页 ${Date.now()}`,
    name = `浏览器权限 ${Date.now()}`;
  const fixture = await page.request.post("/api/v1/products", {
    headers: {
      Origin: process.env.APP_URL!,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: { title: prefix, content: {} },
  });
  expect(fixture.ok()).toBeTruthy();
  const product = await fixture.json();
  if (!process.env.DATABASE_URL?.includes("frameflow_compact"))
    throw new Error("Isolated browser fixture database required");
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  await db.resource.createMany({
    data: Array.from({ length: 125 }, (_, i) => ({
      teamId: me.teamId,
      kind: "product",
      title: prefix + " " + i,
      content: {},
      createdBy: me.userId,
      updatedBy: me.userId,
    })),
  });
  await page.goto("/studio/keys");
  await page.getByRole("button", { name: "创建 API Key", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText(
      `已选择 ${recommendedPermissions.length} / ${permissionIds.length} 项可授权权限`,
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: "查看任务与操作日志", exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: "清空权限", exact: true }).click();
  await dialog
    .getByRole("checkbox", { name: "编辑创意、策划案与分镜", exact: true })
    .check();
  await expect(
    dialog.getByRole("checkbox", {
      name: "查看创意、策划案与分镜",
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "创意策划全选", exact: true }),
  ).toHaveJSProperty("indeterminate", true);
  await dialog
    .getByRole("checkbox", { name: "查看创意、策划案与分镜", exact: true })
    .uncheck();
  await expect(
    dialog.getByRole("checkbox", {
      name: "编辑创意、策划案与分镜",
      exact: true,
    }),
  ).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: "全选权限", exact: true }).check();
  await expect(
    dialog.getByRole("checkbox", { name: "查看任务与操作日志", exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "恢复推荐", exact: true }).click();
  await expect(
    dialog.getByRole("checkbox", { name: "查看任务与操作日志", exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole("radio", { name: /指定产品/ }).check();
  await dialog.getByRole("button", { name: "清空产品", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "确认保存", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("名称", { exact: true }).fill(name);
  await dialog.getByLabel("搜索授权产品", { exact: true }).fill(prefix);
  await expect(dialog.getByText("第 1 / 3 页 · 126 个产品", {exact:true})).toBeVisible();
  await dialog
    .getByRole("button", { name: "全选当前搜索结果", exact: true })
    .click();
  await expect(
    dialog.getByText("已选 126 个产品", { exact: true }),
  ).toBeVisible();
  await dialog.getByText("权限范围", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/key-permissions-desktop.png" });
  await dialog.getByRole("button", { name: "确认保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toContainText("126 个产品");
  await row.getByText(/完整授权/).click();
  await expect(row).toContainText("提交视频生成审批");
  await row.getByRole("button", { name: "编辑 " + name, exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("radio", { name: /指定产品/ }),
  ).toBeChecked();
  await expect(
    page.getByRole("dialog").getByText("已选 126 个产品", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    dialog.getByRole("button", { name: "确认保存", exact: true }),
  ).toBeVisible();
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/key-permissions-mobile.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const keys = await (await page.request.get("/api/v1/api-keys")).json();
  const key = keys.items.find((k: any) => k.name === name);
  await page.request.delete("/api/v1/api-keys/" + key.id, {
    headers: { Origin: process.env.APP_URL! },
  });
  await page.request.patch("/api/v1/products/" + product.id, {
    headers: { Origin: process.env.APP_URL! },
    data: {
      title: product.title,
      content: product.content,
      status: "archived",
      baseVersion: product.version,
    },
  });
  await db.resource.updateMany({
    where: { teamId: me.teamId, title: { startsWith: prefix } },
    data: { status: "archived" },
  });
  await db.$disconnect();
});
