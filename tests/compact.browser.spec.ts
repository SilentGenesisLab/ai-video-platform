import { test, expect } from "@playwright/test";
const created: string[] = [];
async function login(page: any) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "邮箱密码" }).click();
  await page.getByLabel("邮箱").fill(process.env.ADMIN_EMAIL!);
  await page
    .locator('input[name="password"]')
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await expect(page).toHaveURL(/studio/);
}
async function product(page: any) {
  const r = await page.request.post("/api/v1/products", {
    headers: {
      Origin: process.env.APP_URL!,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      title: "浏览器验收 · 紧凑洞察 " + Date.now(),
      content: {
        sellingPointItems: Array.from({ length: 6 }, (_, i) => ({
          id: `point-${i}`,
          title: `核心卖点 ${i + 1}`,
          benefit: "保留的用户收益",
        })),
        audienceSegments: [
          { id: "audience", name: "校园管理员", pain: "停车空间有限" },
        ],
      },
    },
  });
  expect(r.ok()).toBeTruthy();
  const p = await r.json();
  created.push(p.id);
  return p;
}
test("compact insights: core overview, expand, preserve fields, keyboard dropdown and mobile", async ({
  page,
}) => {
  await login(page);
  const p = await product(page);
  await page.goto(`/studio/products/${p.id}?tab=insights`);
  await expect(page.getByText("核心卖点 1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("用户收益", { exact: true })).toHaveCount(0);
  const panels = page.locator(".pd-insights > .pd-panel");
  const a = await panels.nth(0).boundingBox(),
    b = await panels.nth(1).boundingBox();
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  await page
    .locator(".pd-row-toggle")
    .filter({ hasText: "核心卖点 1" })
    .click();
  await expect(page.getByLabel("用户收益", { exact: true })).toHaveValue(
    "保留的用户收益",
  );
  await page.getByLabel("卖点描述", { exact: true }).fill("整理后的核心卖点");
  await page.getByRole("button", { name: "保存产品", exact: true }).click();
  await expect(page.getByText("所有修改已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("整理后的核心卖点", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("用户收益", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "产品概览", exact: true }).click();
  const status = page.getByRole("combobox", { name: "产品状态", exact: true });
  await status.click();
  await expect(
    page.getByRole("option", { name: "已就绪", exact: true }),
  ).toBeVisible();
  await page.getByRole("option", { name: "已就绪", exact: true }).click();
  await expect(status).toHaveText("已就绪");
  await status.focus();
  await status.press("ArrowDown");
  await page.locator(".ff-select-menu").press("Home");
  await page.locator(".ff-select-menu").press("Enter");
  await expect(status).toHaveText("草稿");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "产品洞察", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: ".runtime/compact-mobile.png",
    fullPage: true,
  });
});
test("shared multi-select searches reference files and saves selected IDs", async ({
  page,
}) => {
  await login(page);
  const p = await product(page),
    ids: string[] = [];
  for (let i = 1; i <= 2; i++) {
    const buffer = Buffer.from("验收资料 " + i);
    const init = await page.request
      .post("/api/v1/files", {
        headers: {
          Origin: process.env.APP_URL!,
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: {
          productId: p.id,
          name: `关联资料${i}.md`,
          mime: "text/markdown",
          bytes: buffer.length,
          parsePolicy: "skip",
        },
      })
      .then((r) => r.json());
    const upload = await page.request.post(
      `/api/v1/files/${init.file.id}/upload`,
      {
        headers: {
          Origin: process.env.APP_URL!,
          "Idempotency-Key": crypto.randomUUID(),
        },
        multipart: {
          file: { name: `关联资料${i}.md`, mimeType: "text/markdown", buffer },
        },
      },
    );
    expect(upload.ok()).toBeTruthy();
    const complete = await page.request.post(
      `/api/v1/files/${init.file.id}/complete`,
      {
        headers: {
          Origin: process.env.APP_URL!,
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: {},
      },
    );
    expect(complete.ok()).toBeTruthy();
    ids.push(init.file.id);
  }
  const patch = await page.request.patch(`/api/v1/products/${p.id}`, {
    headers: {
      Origin: process.env.APP_URL!,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      title: p.title,
      baseVersion: p.version,
      content: {
        materials: ids.map((fileId, i) => ({
          id: `material-${i}`,
          fileId,
          category: "document",
          title: `关联资料${i + 1}.md`,
        })),
      },
    },
  });
  expect(patch.ok()).toBeTruthy();
  await page.goto(`/studio/products/${p.id}?tab=insights`);
  await page
    .locator(".pd-row-toggle")
    .filter({ hasText: "核心卖点 1" })
    .click();
  await page.getByRole("combobox", { name: "关联资料", exact: true }).click();
  await page.getByRole("option", { name: "关联资料1.md", exact: true }).click();
  await page.getByRole("option", { name: "关联资料2.md", exact: true }).click();
  await page.getByRole("button", { name: "完成选择", exact: true }).click();
  await page.getByRole("button", { name: "保存产品", exact: true }).click();
  await expect(page.getByText("所有修改已保存", { exact: true })).toBeVisible();
  const saved = await page.request
    .get(`/api/v1/products/${p.id}`)
    .then((r) => r.json());
  expect([...saved.content.sellingPointItems[0].fileIds].sort()).toEqual(
    [...ids].sort(),
  );
});
test("creative cards: one title, insight and score without duplicate cover", async ({
  page,
}) => {
  await login(page);
  const p = await product(page);
  const r = await page.request.post("/api/v1/concepts", {
    headers: {
      Origin: process.env.APP_URL!,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      title: "只有一次的创意名称",
      productId: p.id,
      content: {
        idea: "用户真正关心的是省空间",
        hook: "开场钩子不在列表重复显示",
        score: 8,
      },
    },
  });
  expect(r.ok()).toBeTruthy();
  await page.goto(`/studio/creative?productId=${p.id}`);
  const card = page
    .locator(".concept-card")
    .filter({ hasText: "只有一次的创意名称" });
  await expect(card).toBeVisible();
  await expect(
    card.getByText("只有一次的创意名称", { exact: true }),
  ).toHaveCount(1);
  await expect(
    card.getByText("用户真正关心的是省空间", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("评分 8 / 10", { exact: true })).toBeVisible();
  await expect(card.locator(".card-media")).toHaveCount(0);
  await page.screenshot({
    path: ".runtime/compact-creative.png",
    fullPage: true,
  });
});
test("official price configuration: deep link, safe initialization and unchanged existing rates", async ({
  page,
}) => {
  await login(page);
  await page.goto("/team?tab=platform#purchase-rates");
  await expect(page).toHaveURL(/\/admin/);
  const before = await page.request
    .get("/api/v1/platform/rates")
    .then((r) => r.json());
  const initialization = await page.request.post(
    "/api/v1/platform/rates/official-deepseek",
    {
      headers: {
        Origin: process.env.APP_URL!,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {},
    },
  );
  expect(initialization.ok()).toBe(true);
  const published = await initialization.json();
  const first = await page.request
    .get("/api/v1/platform/rates")
    .then((r) => r.json());
  const imported = first.items.filter(
    (r: any) => r.model === "deepseek-flash" && r.sourceType !== "estimated",
  );
  expect(imported.length).toBeGreaterThanOrEqual(2);
  expect(
    published.items.every(
      (r: any) =>
        Number(r.inputRate) === 2 &&
        Number(r.cachedInputRate) === 0.04 &&
        Number(r.rate) === 8,
    ),
  ).toBeTruthy();
  for (const prior of before.items)
    expect(first.items.find((r: any) => r.id === prior.id)).toEqual(prior);
  await page.request.post("/api/v1/platform/rates/official-deepseek", {
    headers: {
      Origin: process.env.APP_URL!,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {},
  });
  const second = await page.request
    .get("/api/v1/platform/rates")
    .then((r) => r.json());
  expect(second.items.length).toBe(first.items.length);
});
test.afterEach(async ({ page }) => {
  for (const id of created.splice(0)) {
    const p = await page.request
      .get(`/api/v1/products/${id}`)
      .then((r) => r.json());
    await page.request.patch(`/api/v1/products/${id}`, {
      headers: {
        Origin: process.env.APP_URL!,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        title: p.title,
        baseVersion: p.version,
        status: "archived",
        content: {},
      },
    });
  }
});
