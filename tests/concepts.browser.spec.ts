import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { chooseSelect } from "./select-helper";
test("concept filters, cross-page sorting, score revisions and reversible deletion", async ({
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
  const product = await call("/products", "POST", {
    title: "创意筛选测试 " + randomUUID(),
    content: {},
  });
  const concepts = [];
  for (let i = 0; i < 33; i++)
    concepts.push(
      await call("/concepts", "POST", {
        title: "创意 " + i,
        productId: product.id,
        status: i === 0 ? "selected" : "draft",
        content: { idea: "测试创意", ...(i === 32 ? {} : { score: i % 11 }) },
      }),
    );
  const high = await call(
    `/concepts?productId=${product.id}&sort=score-desc&limit=5`,
  );
  expect(high.total).toBe(33);
  expect(high.items).toHaveLength(5);
  expect(high.items[0].content.score).toBe(10);
  expect(
    high.items.every(
      (r: any, i: number, a: any[]) =>
        i === 0 || r.content.score <= a[i - 1].content.score,
    ),
  ).toBe(true);
  const last = await call(
    `/concepts?productId=${product.id}&sort=score-desc&page=7&limit=5`,
  );
  expect(last.items.at(-1).id).toBe(concepts[32].id);
  expect(
    (await call(`/concepts?productId=${product.id}&rating=unscored`)).total,
  ).toBe(1);
  expect(
    (await call(`/concepts?productId=${product.id}&status=selected`)).total,
  ).toBe(1);
  expect(
    (await call(`/concepts?productId=${product.id}&sort=time-asc&limit=1`))
      .items[0].id,
  ).toBe(concepts[0].id);
  const plan = await call("/plans", "POST", {
    title: "关联策划",
    productId: product.id,
    parentId: concepts[0].id,
    content: {},
  });
  await page.goto("/studio/creative?productId=" + product.id);
  await chooseSelect(page, "创意状态筛选", "selected");
  await page
    .getByRole("button", { name: "评分：创意 0", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "评分：创意 0", exact: true }).click();
  await page.getByLabel("人工评分（0–10）", { exact: true }).fill("9.5");
  await page.getByRole("button", { name: "保存评分", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("评分已保存");
  const revised = await call("/concepts/" + concepts[0].id);
  expect(revised.content.score).toBe(9.5);
  expect(revised.version).toBe(2);
  const conflict = await page.request.patch("/api/v1/concepts/" + revised.id, {
    headers: { Origin: process.env.APP_URL! },
    data: {
      title: revised.title,
      productId: product.id,
      content: revised.content,
      baseVersion: 1,
    },
  });
  expect(conflict.status()).toBe(409);
  await page
    .getByRole("button", { name: "删除创意：创意 0", exact: true })
    .click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已删除");
  await expect(
    page.getByRole("button", { name: "删除创意：创意 0", exact: true }),
  ).toHaveCount(0);
  expect((await call("/plans/" + plan.id)).parentId).toBe(revised.id);
  await page.getByLabel("已归档", { exact: true }).check();
  await page
    .getByRole("button", { name: "恢复创意：创意 0", exact: true })
    .click();
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已恢复");
  await page.getByLabel("已归档", { exact: true }).uncheck();
  await chooseSelect(page, "创意状态筛选", "");
  await chooseSelect(page, "创意评分筛选", "unscored");
  await expect(page.locator(".concept-card")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
