import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "邮箱密码" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await page.waitForURL("**/studio/products");
}
async function api(page: Page, path: string, method = "GET", data?: any) {
  const r = await page.request.fetch("/api/v1" + path, {
    method,
    data,
    headers: { Origin: process.env.APP_URL!, "Idempotency-Key": randomUUID() },
  });
  expect(r.ok(), path + " " + (await r.text())).toBeTruthy();
  return r.json();
}
for (const mode of ["success", "failure", "stale"])
  test(
    "PLAN-" + mode + " editor generation progress and outcome",
    async ({ page }) => {
      test.skip(
        !process.env.APP_URL?.includes("127.0.0.1"),
        "Local fixtures only",
      );
      await login(page);
      const product = await api(page, "/products", "POST", {
        title: "Plan UI " + randomUUID(),
        content: {},
      });
      const concept = await api(page, "/concepts", "POST", {
        title: "Creative UI " + randomUUID(),
        productId: product.id,
        content: { hook: "Known hook" },
      });
      const plan = await api(page, "/plans", "POST", {
        title: "Generated UI " + randomUUID(),
        productId: product.id,
        parentId: concept.id,
        content: { story: "story", body: "Editable generated body" },
      });
      let requests = 0;
      const job = {
        id: randomUUID(),
        kind: "plan_generation",
        status: "queued",
        input: { concept: { version: 1 } },
        result: null as any,
      };
      await page.route(
        "**/api/v1/concepts/" + concept.id + "/generate-plan",
        async (route) => {
          requests++;
          expect(route.request().postDataJSON().baseVersion).toBe(1);
          await route.fulfill({
            status: mode === "stale" ? 409 : 200,
            json:
              mode === "stale"
                ? { error: { message: "创意已更新，请刷新后生成" } }
                : job,
          });
        },
      );
      await page.route("**/api/v1/jobs/" + job.id, (route) =>
        route.fulfill({ json: job }),
      );
      try {
        await page.goto("/studio/creative?productId=" + product.id);
        const card = page
          .locator(".resource-card")
          .filter({ hasText: concept.title });
        await card
          .getByRole("button", { name: "查看与编辑", exact: true })
          .click();
        const modal = page
          .getByRole("dialog")
          .filter({ hasText: concept.title });
        await modal
          .getByRole("button", { name: "生成策划案", exact: true })
          .click();
        if (mode === "stale")
          await expect(modal.getByRole("alert")).toContainText("创意已更新");
        else {
          await expect(
            modal.getByRole("button", { name: "策划案生成中…" }),
          ).toBeDisabled();
          job.status = mode === "success" ? "succeeded" : "failed";
          job.result = { planId: plan.id };
          (job as any).error = "Workflow unavailable";
          if (mode === "success") {
            await modal.getByRole("button", { name: "打开策划案" }).click();
            await expect(page.getByRole("dialog")).toContainText(plan.title);
            await expect(
              page.getByRole("dialog").getByText("保存修订", { exact: true }),
            ).toBeVisible();
          } else
            await expect(
              modal.getByRole("button", { name: "重试生成策划案" }),
            ).toBeVisible();
        }
        expect(requests).toBe(1);
      } finally {
        for (const [route, item] of [
          ["plans", plan],
          ["concepts", concept],
          ["products", product],
        ] as const)
          await api(page, "/" + route + "/" + item.id, "DELETE", {
            baseVersion: item.version,
          });
      }
    },
  );

test("PLAN-LIVE n8n and DeepSeek create editable treatment without personal credit consumption", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_LIVE_N8N !== "1",
    "Explicit real workflow verification",
  );
  test.setTimeout(270000);
  await login(page);
  const wallet = await api(page, "/billing/wallet");
  const product = await api(page, "/products", "POST", {
    title: "n8n 验收 · 桌面收纳盒 " + randomUUID(),
    content: {
      description: "用于整理桌面文具和小物件，不提供未经证实的材质、价格和效果",
      sellingPoints: ["分类收纳", "桌面清晰"],
      audience: "居家办公用户",
    },
  });
  const concept = await api(page, "/concepts", "POST", {
    title: "n8n验收 · 找回桌面",
    productId: product.id,
    status: "selected",
    content: {
      hook: "找一支笔却翻遍桌面",
      idea: "用一个桌面收纳盒展示整理前后的动作差异",
      structure: "乱桌找笔→分类收纳→从容拿取→产品展示",
      emotion: "焦急→舒缓",
      selfReview: "真实日常动作，避免夸张对比",
      comments: "30秒，16:9，不生图、不生视频。",
    },
  });
  let plan: any;
  try {
    await page.goto("/studio/creative?productId=" + product.id);
    await page
      .locator(".resource-card")
      .filter({ hasText: concept.title })
      .getByRole("button", { name: "查看与编辑", exact: true })
      .click();
    const submission = page.waitForResponse(
      (r) =>
        r.url().includes(`/concepts/${concept.id}/generate-plan`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "生成策划案", exact: true })
      .click();
    const submitted = await submission;
    expect(submitted.ok(), await submitted.text()).toBeTruthy();
    const task = await submitted.json();
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      const progress = await api(page, "/jobs/" + task.id);
      expect(progress.status, progress.error ?? "Workflow failed").not.toBe(
        "failed",
      );
      if (progress.status === "succeeded") break;
      await page.waitForTimeout(2000);
    }
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "打开策划案" })
      .waitFor({ timeout: 240000 });
    const plans = await api(page, "/plans?productId=" + product.id);
    plan = plans.items.find((p: any) => p.parentId === concept.id);
    expect(plan).toBeTruthy();
    expect(plan.content.body.length).toBeGreaterThan(500);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "打开策划案" })
      .click();
    await expect(page.getByRole("dialog")).toContainText(plan.title);
    expect(Number((await api(page, "/billing/wallet")).balance)).toBe(
      Number(wallet.balance),
    );
    const full = await api(page, "/plans/" + plan.id);
    expect(
      full.revisions[0].sources.some((s: any) => s.resourceId === concept.id),
    ).toBe(true);
  } finally {
    if (plan)
      await api(page, "/plans/" + plan.id, "DELETE", {
        baseVersion: plan.version,
      });
    const latest = await api(page, "/concepts/" + concept.id);
    await api(page, "/concepts/" + concept.id, "DELETE", {
      baseVersion: latest.version,
    });
    await api(page, "/products/" + product.id, "DELETE", {
      baseVersion: product.version,
    });
  }
});
