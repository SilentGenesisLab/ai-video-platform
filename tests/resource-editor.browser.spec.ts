import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("creative editor expands full text and keeps footer outside scroll region", async ({
  page,
}) => {
  test.skip(
    !process.env.DATABASE_URL?.includes("frameflow_compact"),
    "Isolated fixtures only",
  );
  await page.goto("/login");
  await page.getByRole("tab", { name: "邮箱密码" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await page.waitForURL("**/studio/products");
  const call = async (path: string, method: string, data?: any) => {
    const response = await page.request.fetch("/api/v1" + path, {
      method,
      data,
      headers: {
        Origin: process.env.APP_URL!,
        "Idempotency-Key": randomUUID(),
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  const product = await call("/products", "POST", {
    title: "展开测试 " + randomUUID(),
    content: {},
  });
  const text = Array.from(
    { length: 30 },
    (_, index) => `${index + 1}：完整显示这一行创意内容，保留所有文字。`,
  ).join("\n");
  const concept = await call("/concepts", "POST", {
    title: "长文本 " + randomUUID(),
    productId: product.id,
    content: { hook: text, idea: text, structure: text },
  });
  try {
    await page.goto("/studio/creative?productId=" + product.id);
    const card = page
      .locator(".resource-card")
      .filter({ hasText: concept.title });
    await card.getByRole("button", { name: "查看与编辑", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "收起长文本", exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    const hook = dialog.getByLabel("开场钩子", { exact: true });
    const assertExpanded = async () => {
      expect(
        await hook.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
      ).toBeTruthy();
      await expect(hook).toHaveValue(text);
    };
    await assertExpanded();
    const footer = dialog.locator(".resource-editor-footer");
    const before = await footer.boundingBox();
    await dialog.locator(".resource-editor-scroll").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const after = await footer.boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThan(1);
    await expect(
      footer.getByRole("button", { name: "保存修订", exact: true }),
    ).toBeInViewport();
    await dialog
      .getByRole("button", { name: "收起长文本", exact: true })
      .click();
    expect(
      await hook.evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBeTruthy();
    await dialog
      .getByRole("button", { name: "展开全部文本", exact: true })
      .click();
    await assertExpanded();
    await page.setViewportSize({ width: 390, height: 844 });
    await assertExpanded();
    await expect(
      footer.getByRole("button", { name: "保存修订", exact: true }),
    ).toBeInViewport();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBeTruthy();
    await hook.fill(text + "\n新增的一行内容");
    expect(
      await hook.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBeTruthy();
    await footer.getByRole("button", { name: "保存修订", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const saved = await call("/concepts/" + concept.id, "GET");
    expect(saved.content.hook).toBe(text + "\n新增的一行内容");
  } finally {
    await call("/concepts/" + concept.id, "DELETE");
    await call("/products/" + product.id, "DELETE");
  }
});
