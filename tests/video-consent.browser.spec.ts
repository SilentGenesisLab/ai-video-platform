import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function setup(page: Page, balance = 1000) {
  await page.goto("/login");
  await page.getByRole("tab", { name: "邮箱密码" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(process.env.ADMIN_EMAIL!);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "进入工作台" }).click();
  await page.waitForURL("**/studio/products");
  const response = await page.request.post("/api/v1/conversations", {
    headers: { Origin: process.env.APP_URL!, "Idempotency-Key": randomUUID() },
    data: { title: "视频积分确认测试" },
  });
  expect(response.ok()).toBeTruthy();
  const conversation = await response.json();
  const batch: any = {
    id: randomUUID(),
    title: "会话视频",
    kind: "video",
    status: "pending_approval",
    canConfirm: true,
    payerIsCurrentUser: true,
    digest: "quote-1",
    estimatedCredits: "150",
    count: 1,
    quoteExpiresAt: new Date(Date.now() + 600000).toISOString(),
    entries: [
      {
        model: "seedance-2.5",
        prompt: "蓝色折叠伞在雨中展开",
        parameters: { duration_seconds: 5, resolution: "720p" },
      },
    ],
    jobs: [],
  };
  const approvals: any[] = [];
  let stage = "pending_approval",
    calls = 0;
  await page.route("**/api/v1/billing/wallet", (r) =>
    r.fulfill({ json: { balance: String(balance), frozen: "0" } }),
  );
  await page.route(
    `**/api/v1/production-batches/${batch.id}/refresh-quote`,
    (r) => {
      calls++;
      return r.fulfill({ json: { ...batch, digest: "quote-" + calls } });
    },
  );
  await page.route(`**/api/v1/approvals/${batch.id}`, async (r) => {
    const body = r.request().postDataJSON();
    approvals.push(body);
    stage = body.decision === "approve" ? "queued" : "rejected";
    await r.fulfill({ json: { id: batch.id, status: stage } });
  });
  await page.route(`**/api/v1/conversations/${conversation.id}/media`, (r) =>
    r.fulfill({
      json: {
        items: [
          {
            ...batch,
            status: stage,
            jobs:
              stage === "pending_approval"
                ? []
                : [
                    {
                      id: "job",
                      status: stage,
                      files:
                        stage === "succeeded"
                          ? [
                              {
                                id: "file",
                                mime: "video/mp4",
                                url: "https://media.example.test/result.mp4",
                              },
                            ]
                          : [],
                    },
                  ],
          },
        ],
      },
    }),
  );
  await page.route("https://media.example.test/**", (r) =>
    r.fulfill({ status: 200, body: "", contentType: "video/mp4" }),
  );
  await page.getByRole("button", { name: "创作搭档", exact: true }).click();
  await page
    .locator(".assistant-panel select")
    .first()
    .selectOption(conversation.id, { force: true });
  const dialog = page.getByRole("dialog", { name: "确认视频生成" });
  await expect(dialog).toBeVisible();
  if (balance >= 150)
    await expect(
      dialog.getByRole("button", { name: "同意生成", exact: true }),
    ).toBeEnabled();
  else await expect(dialog).toContainText("积分不足");
  return {
    dialog,
    approvals,
    batch,
    setStage: (s: string) => {
      stage = s;
    },
    getQuoteCalls: () => calls,
  };
}
test("CONSENT-01 quote popup starts video only after human agrees and shows result", async ({
  page,
}) => {
  const { dialog, approvals, batch, setStage } = await setup(page);
  await expect(dialog).toContainText("150");
  await expect(dialog).toContainText("共 1 个视频");
  expect(approvals).toHaveLength(0);
  await dialog.getByRole("button", { name: "同意生成", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(approvals).toHaveLength(1);
  expect(approvals[0]).toEqual({ decision: "approve", digest: "quote-1" });
  const card = page.locator(`[data-batch-id="${batch.id}"]`);
  await expect(card).toContainText("排队中");
  setStage("succeeded");
  await expect(card.locator("video")).toBeVisible({ timeout: 10000 });
  await expect(card.locator("video")).toHaveAttribute("controls", "");
  expect(approvals).toHaveLength(1);
});
test("CONSENT-02 cancel never starts generation", async ({ page }) => {
  const { dialog, approvals } = await setup(page);
  await dialog.getByRole("button", { name: "取消生成", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(approvals).toEqual([{ decision: "reject", digest: "quote-1" }]);
});
test("CONSENT-03 insufficient credits disable generation", async ({ page }) => {
  const { approvals } = await setup(page, 20);
  const dialog = page.getByRole("dialog", { name: "确认视频生成" });
  await expect(
    dialog.getByRole("button", { name: "同意生成", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText("积分不足");
  expect(approvals).toHaveLength(0);
});


test("CONSENT-04 dismiss defers without charging and card reopens confirmation",async({page})=>{
 const {dialog,approvals,batch}=await setup(page);
 await dialog.getByRole("button",{name:"稍后决定",exact:true}).click(); await expect(dialog).toBeHidden();
 await page.locator(`[data-batch-id="${batch.id}"]`).getByRole("button",{name:/确认生成/}).click();
 await expect(dialog).toBeVisible(); await expect(dialog.getByRole("button",{name:"同意生成",exact:true})).toBeEnabled(); expect(approvals).toHaveLength(0);
});
test("CONSENT-05 changed quote requires another explicit human click",async({page})=>{
 const {dialog,approvals,batch}=await setup(page);
 await page.route(`**/api/v1/approvals/${batch.id}`,async r=>{
  approvals.push(r.request().postDataJSON());
  await r.fulfill(approvals.length===1?{status:409,json:{error:{message:"报价已变化"}}}:{json:{id:batch.id,status:"queued"}});
 });
 await dialog.getByRole("button",{name:"同意生成",exact:true}).click();
 await expect(dialog).toContainText("请核对新报价后再次确认"); expect(approvals).toHaveLength(1);
 await dialog.getByRole("button",{name:"同意生成",exact:true}).click(); expect(approvals).toHaveLength(2); expect(approvals[1].digest).toBe("quote-2"); await expect(dialog).toBeHidden();
});
