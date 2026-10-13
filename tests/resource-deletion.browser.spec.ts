import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { chooseSelect } from "./select-helper";
test("delete buttons are at card top-right across production modules", async ({
  page,
}) => {
  test.skip(
    !process.env.APP_URL?.includes("127.0.0.1"),
    "Only isolated local fixtures may be created",
  );
  async function call(path: string, method = "GET", body?: any) {
    const r = await page.request.fetch("/api/v1" + path, {
      method,
      data: body,
      headers: {
        Origin: process.env.APP_URL!,
        "Idempotency-Key": randomUUID(),
      },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  }
  await page.goto("/login");
  await page.getByRole("tab", { name: "邮箱密码" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await page.waitForURL("**/studio/products");
  const suffix = randomUUID();
  const product = await call("/products", "POST", {
    title: "删除UI " + suffix,
    content: {},
  });
  const plan = await call("/plans", "POST", {
    title: "策划UI " + suffix,
    productId: product.id,
    content: {},
  });
  const fixtures: any[] = [
    { resource: product, section: "products", noun: "产品" },
    { resource: plan, section: "creative", tab: "策划案", noun: "策划案" },
  ];
  for (const [route, section, tab, noun] of [
    ["creative-batches", "creative", "创意批次", "创意批次"],
    ["storyboards", "creative", "工业分镜", "分镜"],
    ["assets", "assets", "", "资产"],
    ["scripts", "production", "制作脚本", "制作脚本"],
  ]) {
    const resource = await call("/" + route, "POST", {
      title: noun + suffix,
      productId: product.id,
      ...(["storyboards", "assets", "scripts"].includes(route)
        ? { planId: plan.id }
        : {}),
      content: {},
    });
    fixtures.push({ resource, section, tab, noun });
  }
  for (const fixture of fixtures.reverse()) {
    await page.goto("/studio/" + fixture.section + "?productId=" + product.id);
    if (fixture.tab)
      await page
        .locator(".tabs")
        .getByRole("button", { name: fixture.tab, exact: true })
        .click();
    const button = page.getByRole("button", {
      name: "删除" + fixture.noun + "：" + fixture.resource.title,
      exact: true,
    });
    await expect(button).toBeVisible();
    const position = await button.evaluate((el) => {
      const card = el.closest(".resource-card")!.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      return { top: b.top - card.top, right: card.right - b.right };
    });
    expect(position.top).toBeLessThan(20);
    expect(position.right).toBeLessThan(20);
    await button.click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已删除");
    await expect(button).toHaveCount(0);
  }
  const detailProduct = await call("/products", "POST", {
    title: "详情删除 " + suffix,
    content: {},
  });
  await page.goto("/studio/products/" + detailProduct.id);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除产品", exact: true }).click();
  await page.waitForURL("**/studio/products");
  expect((await call("/products/" + detailProduct.id)).status).toBe("archived");
});
