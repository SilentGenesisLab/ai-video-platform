import { test, expect } from "@playwright/test";
import "dotenv/config";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
const base = process.env.APP_URL ?? "http://127.0.0.1:3012";
async function login(page: any) {
  await page.goto(base + "/login");
  await page.getByRole("tab", {name:"邮箱密码"}).click();
  await page.getByLabel("邮箱").fill(process.env.ADMIN_EMAIL!);
  await page.locator('input[name="password"]').fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await expect(page.getByRole("heading", { name: "产品管理." })).toBeVisible();
}
test("@production product page, structured insight, Brief, references and history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page
    .getByRole("button", { name: "新建产品", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/studio\/products\/new/);
  await page
    .getByLabel("产品名称", { exact: true })
    .fill("浏览器验收 · 产品洞察 " + Date.now());
  await page
    .getByLabel("一句话定位", { exact: true })
    .fill("让园区自行车停放更有序");
  await page
    .getByLabel("产品描述", { exact: true })
    .fill("双层停车设备，事实以现场资料为准。");
  await page.getByRole("button", { name: "保存产品", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/products\/[0-9a-f-]+\?tab=overview/);
  const detailUrl = page.url();
  await page.getByRole("button", { name: "产品洞察", exact: true }).click();
  await page.getByRole("button", { name: "添加卖点", exact: true }).click();
  await page.getByLabel("卖点标题", { exact: true }).fill("增加停车容量");
  await page
    .getByLabel("用户收益", { exact: true })
    .fill("有限空间停放更多车辆");
  await page.getByLabel("证据说明", { exact: true }).fill("等待现场测量");
  await page.getByRole("button", { name: "添加人群", exact: true }).click();
  await page.getByLabel("人群名称", { exact: true }).fill("园区管理者");
  await page.getByLabel("购买顾虑", { exact: true }).fill("维护频率");
  await page.getByRole("button", { name: "产品 Brief", exact: true }).click();
  const brief =
    "# 园区停车 Brief\n\n| 项目 | 内容 |\n| --- | --- |\n| 人群 | 园区管理者 |\n\n- [x] 已有人群\n- [ ] 待核实容量\n\n<script>window.__briefXss=1</script>\n\n[危险](javascript:alert(1))";
  await page.getByLabel("产品 Brief Markdown").fill(brief);
  await expect(page.locator(".pd-markdown-preview table")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__briefXss)).toBeUndefined();
  expect(
    await page.locator(".pd-markdown-preview a").getAttribute("href"),
  ).not.toMatch(/^javascript:/);
  await page.getByRole("button", { name: "保存产品", exact: true }).click();
  await expect(page.getByText("所有修改已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("产品 Brief Markdown")).toHaveValue(brief);
  await page.getByRole("button", { name: "产品洞察", exact: true }).click();
  await expect(page.getByLabel("购买顾虑", { exact: true })).toHaveValue(
    "维护频率",
  );
  await page.screenshot({
    path: ".runtime/product-insights-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "参考视频", exact: true }).click();
  await page.getByRole("button", { name: "添加视频链接", exact: true }).click();
  await page.getByLabel("参考名称", { exact: true }).fill("参考剪辑节奏");
  await page
    .getByLabel("视频链接", { exact: true })
    .fill("https://example.org/reference");
  await page
    .getByLabel("可借鉴点", { exact: true })
    .fill("先展示问题，再展示产品");
  await page.getByRole("button", { name: "保存产品", exact: true }).click();
  await expect(page.getByText("所有修改已保存", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/tab=insights/);
  await page.goForward();
  await expect(page).toHaveURL(/tab=references/);
  await page.getByRole("button", { name: "历史版本", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "产品历史版本" }),
  ).toBeVisible();
  await page.locator(".pd-history-revision summary").first().click();
  await expect(
    page
      .getByRole("dialog", { name: "产品历史版本" })
      .getByText("增加停车容量", { exact: true })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭历史版本" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "产品概览", exact: true }).click();
  await expect(page.getByLabel("产品名称", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: ".runtime/product-insights-mobile.png",
    fullPage: true,
  });
  await page.getByLabel("产品描述", { exact: true }).fill("未保存的修改");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "全部产品", exact: true }).click();
  await expect(page.getByLabel("产品描述", { exact: true })).toHaveValue(
    "未保存的修改",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "全部产品", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/products$/);
  const productCard = page
    .locator(".resource-card")
    .filter({ hasText: /浏览器验收 · 产品洞察/ })
    .first();
  await productCard
    .getByRole("button", { name: "产品资料", exact: true })
    .click();
  await expect(page).toHaveURL(/\/studio\/products\/[0-9a-f-]+$/);
  expect(errors).toEqual([]);
});

test("uploads, skip-analysis references, classification and optimistic merge", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.PRODUCTION_SMOKE === "1",
    "Production validation does not enqueue model parsing",
  );
  await login(page);
  const created = await page.request.post(base + "/api/v1/products", {
    headers: { Origin: base, "Idempotency-Key": crypto.randomUUID() },
    data: { title: "浏览器验收 · 素材工作台 " + Date.now(), content: {} },
  });
  expect(created.ok()).toBeTruthy();
  const product = await created.json();
  await page.goto(base + `/studio/products/${product.id}?tab=materials`);
  const png = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#b4cc89" },
  })
    .png()
    .toBuffer();
  let rejectFirstUpload = true;
  await page.route("**/api/v1/files/*/upload", async (route) => {
    if (rejectFirstUpload) {
      rejectFirstUpload = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByLabel("上传产品素材文件").setInputFiles([
    { name: "产品示意图.png", mimeType: "image/png", buffer: png },
    {
      name: "产品资料.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 说明\n已核实尺寸待补充"),
    },
  ]);
  await expect(
    page.getByRole("button", { name: "重试上传", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("已上传，请保存产品关联", { exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "重试上传", exact: true }).click();
  await expect(
    page.getByText("已上传，请保存产品关联", { exact: true }),
  ).toHaveCount(2);
  await expect(page.locator(".pd-material")).toHaveCount(2);
  await page.getByRole("button", { name: "设为封面", exact: true }).click();
  await page.getByRole("button", { name: "保存产品", exact: true }).click();
  await expect(page.getByText("所有修改已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "参考视频", exact: true }).click();
  await page.getByLabel("上传参考视频文件").setInputFiles({
    name: "演示参考.mp4",
    mimeType: "video/mp4",
    buffer: await readFile("tests/fixtures/reference.mp4"),
  });
  await expect(
    page.getByText("已上传，请保存产品关联", { exact: true }),
  ).toHaveCount(3);
  await expect(page.locator(".pd-row video")).toBeVisible();
  await page.getByRole("button", { name: "保存产品", exact: true }).click();
  await expect(page.getByText("所有修改已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "产品概览", exact: true }).click();
  await page.getByLabel("一句话定位", { exact: true }).fill("本地人类修改");
  const latest = await page.request
    .get(base + `/api/v1/products/${product.id}`)
    .then((r) => r.json());
  const serverUpdate = await page.request.patch(
    base + `/api/v1/products/${product.id}`,
    {
      headers: { Origin: base },
      data: {
        title: latest.title,
        baseVersion: latest.version,
        content: { description: "Agent 更新描述" },
      },
    },
  );
  expect(serverUpdate.ok()).toBeTruthy();
  await page.getByRole("button", { name: "保存产品", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "合并到最新版本", exact: true })
    .click();
  await page
    .getByRole("button", { name: "合并并继续编辑", exact: true })
    .click();
  await expect(page.getByLabel("产品描述", { exact: true })).toHaveValue(
    "Agent 更新描述",
  );
  await expect(page.getByLabel("一句话定位", { exact: true })).toHaveValue(
    "本地人类修改",
  );
  await page.getByRole("button", { name: "保存产品", exact: true }).click();
  await expect(page.getByText("所有修改已保存", { exact: true })).toBeVisible();
});
