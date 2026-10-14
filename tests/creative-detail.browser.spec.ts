import { test, expect, Page } from "@playwright/test";
const productId = "prod-fixture",
  planId = "plan-fixture",
  boardId = "board-fixture";
async function fixture(page: Page, viewer = false) {
  const date = new Date().toISOString();
  const concept = {
    id: "concept-fixture",
    kind: "concept",
    title: "来源创意名称",
    productId,
    version: 3,
    status: "selected",
    createdAt: date,
    updatedAt: date,
    content: { idea: "创意" },
  };
  const plan: any = {
    id: planId,
    kind: "plan",
    title: "展开策划测试",
    productId,
    parentId: concept.id,
    version: 1,
    status: "draft",
    createdAt: date,
    updatedAt: date,
    content: {
      objective: "传播目标".repeat(50),
      audience: "受众",
      message: "表达",
      story: "故事段落\n".repeat(30),
      visualStyle: "深绿",
      sound: "音效",
      duration: 45,
      aspectRatio: "16:9",
      body: "# 策划正文\n\n" + "完整内容，不能截断。\n\n".repeat(50),
    },
  };
  const shot = (id: string) => ({
    id,
    number: id === "shot-a" ? 1 : 2,
    duration: 5,
    description: id + "长画面\n".repeat(20),
    framing: "全景",
    camera: "平视",
    movement: "推镜",
    action: "动作",
    dialogue: "",
    sound: "",
    continuity: "",
    assets: [],
    candidateFileIds: [],
  });
  const board: any = {
    id: boardId,
    kind: "storyboard",
    title: "展开分镜测试",
    productId,
    planId,
    version: 1,
    status: "draft",
    createdAt: date,
    updatedAt: date,
    content: { shots: [shot("shot-a"), shot("shot-b")] },
  };
  const resources = [plan, board];
  let forceConflict = false;
  const revisions = new Map(
    resources.map((r) => [
      r.id,
      [
        {
          ...structuredClone(r),
          sources: [{ resourceId: productId, version: 1 }],
        },
      ],
    ]),
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      u = new URL(request.url()),
      path = u.pathname.replace("/api/v1", ""),
      parts = path.split("/").filter(Boolean);
    let result: any = {};
    let status = 200;
    if (path === "/auth/me")
      result = {
        id: "human",
        userId: "human",
        name: "编辑验收",
        teamId: "team",
        teamName: "验收团队",
        teamRole: viewer ? "viewer" : "owner",
        role: viewer ? "viewer" : "admin",
        scopes: viewer
          ? ["read"]
          : ["read", "write", "generate", "approve", "admin"],
        platformAdmin: !viewer,
        productIds: [],
      };
    else if (parts[0] === "products")
      result = parts[1]
        ? { id: productId, title: "示例产品", content: {}, version: 1 }
        : {
            items: [
              { id: productId, title: "示例产品", content: {}, version: 1 },
            ],
            total: 1,
          };
    else if (parts[0] === "concepts")
      result = parts[1] ? concept : { items: [concept], total: 1 };
    else if (["plans", "storyboards", "resources"].includes(parts[0])) {
      const item = resources.find((r) => r.id === parts[1]);
      if (request.method() === "DELETE" && item) {
        item.status = "archived";
        item.version++;
        result = item;
      } else if (request.method() === "PATCH" && item) {
        const input = request.postDataJSON();
        if (forceConflict || input.baseVersion !== item.version) {
          status = 409;
          result = { error: { message: "版本冲突" } };
        } else {
          Object.assign(item, input, { version: item.version + 1 });
          revisions.get(item.id)!.unshift({
            ...structuredClone(item),
            sources: [{ resourceId: productId, version: 1 }],
          });
          result = item;
        }
      } else if (request.method() === "POST" && !parts[1]) {
        const input = request.postDataJSON();
        const created = {
          ...input,
          id: "created-fixture",
          kind: parts[0] === "plans" ? "plan" : "storyboard",
          version: 1,
          createdAt: date,
          updatedAt: date,
        };
        resources.push(created);
        revisions.set(created.id, [created]);
        result = created;
        status = 201;
      } else
        result = parts[1]
          ? {
              ...item,
              revisions: revisions.get(item?.id) ?? [],
              staleSources: [],
            }
          : {
              items: resources.filter(
                (r) =>
                  r.kind === (parts[0] === "plans" ? "plan" : "storyboard") &&
                  (u.searchParams.get("status") === "archived"
                    ? r.status === "archived"
                    : r.status !== "archived"),
              ),
              total: 1,
            };
    } else if (path === "/stats")
      result = { counts: { product: 1, concept: 1 } };
    else result = { items: [], total: 0 };
    await route.fulfill({ status, json: result });
  });
  return { plan, board, conflict: (value: boolean) => (forceConflict = value) };
}
test("plan full page keeps sidebar, expands content, saves revisions, conflicts and restores list state", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/studio/creative?tab=plans&productId=" + productId);
  await page.getByRole("button", { name: f.plan.title, exact: true }).click();
  await page.waitForURL("**/studio/creative/plans/plan-fixture?**");
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(page.locator(".sidebar")).toHaveCount(1);
  await page
    .locator(".sidebar")
    .evaluate((el) => el.setAttribute("data-persistence", "same"));
  await expect(
    page.getByRole("combobox", { name: "来源创意", exact: true }),
  ).toHaveValue("concept-fixture");
  const body = page.getByLabel("策划正文 · Markdown", { exact: true });
  await expect(body).toHaveValue(f.plan.content.body);
  expect(
    await body.evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
  ).toBe(true);
  await page.getByRole("button", { name: "预览正文", exact: true }).click();
  await expect(page.locator(".cd-markdown h1")).toHaveText("策划正文");
  await page
    .getByRole("button", { name: "编辑 Markdown", exact: true })
    .click();
  await body.fill("# 修改正文\n\n修改已保存");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存新版本");
  expect(f.plan.version).toBe(2);
  await page.getByRole("button", { name: "历史版本", exact: true }).click();
  await expect(page.getByRole("button", { name: /V2 ·/ })).toBeVisible();
  await page.getByRole("button", { name: "关闭历史", exact: true }).click();
  f.conflict(true);
  await body.fill("不应被冲突覆盖");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(page.locator(".cd-conflict")).toContainText("本地修改已保留");
  await expect(body).toHaveValue("不应被冲突覆盖");
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "返回策划案列表", exact: true })
    .click();
  await expect(body).toHaveValue("不应被冲突覆盖");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "返回策划案列表", exact: true })
    .click();
  await page.waitForURL("**/studio/creative?**");
  await expect(page.locator(".sidebar")).toHaveAttribute(
    "data-persistence",
    "same",
  );
  await expect(page.locator(".tabs .active")).toHaveText("策划案");
  await page.goBack();
  await expect(body).toHaveValue("# 修改正文\n\n修改已保存");
  await body.fill("后退需要提醒");
  page.once("dialog", (d) => d.dismiss());
  await page.evaluate(() => history.back());
  await expect(body).toHaveValue("后退需要提醒");
  page.once("dialog", (d) => d.accept());
  await page.evaluate(() => history.back());
  await page.waitForURL("**/studio/creative?**");
});
test("storyboard expands every shot, reorders stable IDs, new routes and responsive layouts", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/studio/creative/storyboards/" + boardId);
  await expect(page.locator(".cd-shot")).toHaveCount(2);
  await expect(page.getByLabel("镜头1 · 画面")).toBeVisible();
  await page.getByRole("button", { name: "下移镜头1", exact: true }).click();
  await expect(page.getByLabel("镜头1 · 画面")).toHaveValue(
    f.board.content.shots[1].description,
  );
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存新版本");
  expect(f.board.content.shots.map((s: any) => s.id)).toEqual([
    "shot-b",
    "shot-a",
  ]);
  expect(f.board.content.shots.map((s: any) => s.number)).toEqual([1, 2]);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .getByLabel("镜头1 · 画面")
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
    ).toBe(true);
  }
  await page.goto(
    "/studio/creative/plans/new?productId=" +
      productId +
      "&parentId=concept-fixture",
  );
  await page.getByLabel("名称", { exact: true }).fill("新策划");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await page.waitForURL("**/studio/creative/plans/created-fixture?**");
  await page.reload();
  await expect(page.getByLabel("名称", { exact: true })).toHaveValue("新策划");
});
test("read-only full page has no writes and Markdown readable; legacy Agent resource link navigates", async ({
  page,
}) => {
  await fixture(page, true);
  await page.goto("/studio/creative?id=" + planId);
  await page.waitForURL("**/studio/creative/plans/plan-fixture?**");
  await expect(
    page.getByRole("button", { name: "保存修订", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("名称", { exact: true })).toBeDisabled();
  await expect(page.locator(".cd-markdown h1")).toHaveText("策划正文");
});
