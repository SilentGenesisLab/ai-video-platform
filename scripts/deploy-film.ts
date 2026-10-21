import { config as loadEnv } from "dotenv";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 把 Frameflow Film 的 7 条工作流部署到 n8n。
 *
 * 两个 Windows 下的坑，别踩：
 *  1. 内联 `-d '{...}'` 传中文会被命令行编码搞坏 → n8n 收到的节点名退化成 U+FFFD，
 *     不同节点因此重名而被拒。**必须**把请求体写文件后 `--data-binary @file`。
 *  2. Node 默认按系统代码页（GBK）解码子进程输出 → 读回的中文变 U+FFFD，
 *     连工作流名都匹配不上。**必须** encoding:"buffer" 再显式按 utf8 解。
 *
 * 工作流之间用 ID 互相引用，而 ID 创建后才有 → 两趟：先建（引用留空），再回填并激活。
 *
 * 幂等：只清理名称以 "Frameflow Film · " 开头的旧件（不会碰用户自己的
 * "Frameflow · 创意生成策划案 v1"），然后整组重建。
 */

const N8N = process.env.N8N_BASE_URL ?? "https://n8n.sligenai.cn";
const KEY = process.env.N8N_API_KEY ?? "";
const PROXY = process.env.N8N_PROXY ?? "http://127.0.0.1:7888";
const FILM_PREFIX = "Frameflow Film · ";

const IDS = {
  jobsTable: process.env.FILM_JOBS_TABLE ?? "",
  unitsTable: process.env.FILM_UNITS_TABLE ?? "",
  heartbeatTable: process.env.FILM_HEARTBEAT_TABLE ?? "",
  credAiCentre: process.env.FILM_CRED_AICENTRE ?? "",
  credDeepSeek: process.env.FILM_CRED_DEEPSEEK ?? "",
  credPlatform: process.env.FILM_CRED_PLATFORM ?? "",
  credOrderToken: process.env.FILM_CRED_ORDER ?? "",
};

const run = promisify(execFile);
const PAYLOAD_DIR = mkdtempSync(join(tmpdir(), "frameflow-film-deploy-"));
let seq = 0;

interface ApiResult {
  status: number;
  body: any;
  raw: string;
}

async function api(method: string, path: string, body?: unknown): Promise<ApiResult> {
  const args = [
    "-s", "-m", "180", "--proxy", PROXY, "-X", method, N8N + path,
    "-H", "X-N8N-API-KEY: " + KEY,
    "-w", "\n__HTTP__%{http_code}",
  ];
  if (body !== undefined) {
    const file = join(PAYLOAD_DIR, "payload-" + seq++ + ".json");
    writeFileSync(file, JSON.stringify(body), "utf8");
    args.push("-H", "Content-Type: application/json", "--data-binary", "@" + file);
  }
  const { stdout } = await run("curl", args, {
    maxBuffer: 128 * 1024 * 1024,
    encoding: "buffer" as never,
  } as never);
  const text = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout);
  const at = text.lastIndexOf("__HTTP__");
  const payload = text.slice(0, at).trim();
  const status = Number(text.slice(at + 8).trim());
  let parsed: any = null;
  try {
    parsed = payload ? JSON.parse(payload) : null;
  } catch {
    /* 保留原文便于人工核对 */
  }
  return { status, body: parsed, raw: payload };
}

function must(res: ApiResult, what: string) {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      what + " 失败 HTTP " + res.status + " " +
      (res.body ? JSON.stringify(res.body) : res.raw).slice(0, 800),
    );
  }
  return res.body;
}

/**
 * 平台合成凭据：n8n 调平台 `internal/film-assemble` 时带 `x-service-secret`。
 * 优先用 FILM_CRED_PLATFORM；否则按名字找；再没有就现场建一个。
 */
async function ensurePlatformCredential() {
  if (IDS.credPlatform) return IDS.credPlatform;
  const name = "Frameflow Film · 平台合成";
  const listed = await api("GET", "/api/v1/credentials?limit=250");
  if (listed.status === 200 && Array.isArray(listed.body?.data)) {
    const hit = listed.body.data.find((c: any) => String(c.name) === name);
    if (hit) return String(hit.id);
  }
  const secret = process.env.FILM_PLATFORM_SECRET ?? "";
  if (!secret) {
    throw new Error(
      "缺少平台内部服务密钥：设 FILM_PLATFORM_SECRET（= 平台 INTERNAL_SERVICE_SECRET），" +
        "或先在 n8n 建一个 httpHeaderAuth 凭据并把 ID 填进 FILM_CRED_PLATFORM",
    );
  }
  const created = must(await api("POST", "/api/v1/credentials", {
    name,
    type: "httpHeaderAuth",
    data: { name: "x-service-secret", value: secret },
  }), "创建平台合成凭据");
  console.log("credential:", name, created.id);
  return String(created.id);
}

async function main() {
  if (!KEY) throw new Error("缺少 N8N_API_KEY");
  IDS.credPlatform = await ensurePlatformCredential();

  const missing = Object.entries(IDS).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error("缺少底座配置：" + missing.join(", ") +
      "\n先跑 rebuild_tables.py，再用 film-infra.json 里的值设环境变量。");
  }

  const { filmOrder, filmOrchestrator, filmUnit, filmAssembly, filmCron, filmApprove, filmStatus } =
    await import("./film-workflow");

  const ids = { unit: "", assembly: "", orchestrator: "", approve: "", status: "", order: "", cron: "" };

  const build = (next: typeof ids = ids) => {
    const o = {
      ...next,
      jobsTable: IDS.jobsTable,
      unitsTable: IDS.unitsTable,
      heartbeatTable: IDS.heartbeatTable,
      credAiCentre: IDS.credAiCentre,
      credDeepSeek: IDS.credDeepSeek,
      credPlatform: IDS.credPlatform,
      credOrderToken: IDS.credOrderToken,
      platformBase: process.env.FILM_PLATFORM_BASE ?? "https://aivideo.sligenai.cn",
      unitConcurrency: Number(process.env.FILM_UNIT_CONCURRENCY ?? 3),
      aspectRatio: process.env.FILM_ASPECT_RATIO ?? "16:9",
      targetSeconds: Number(process.env.FILM_TARGET_SECONDS ?? 40),
      // 交付级混音：平台 film-assemble 的两遍 loudnorm + 限幅 + 结尾淡出（已实测生效）
      targetLufs: Number(process.env.FILM_TARGET_LUFS ?? -16),
      limitDbtp: Number(process.env.FILM_LIMIT_DBTP ?? -1.5),
      fadeOutSec: Number(process.env.FILM_FADE_OUT_SEC ?? 2.5),
    };
    return [
      { key: "unit", wf: filmUnit(o) },
      { key: "assembly", wf: filmAssembly(o) },
      { key: "orchestrator", wf: filmOrchestrator(o) },
      { key: "approve", wf: filmApprove(o) },
      { key: "status", wf: filmStatus(o) },
      { key: "order", wf: filmOrder(o) },
      { key: "cron", wf: filmCron(o) },
    ];
  };

  const order = ["unit", "assembly", "orchestrator", "approve", "status", "order", "cron"];

  // 同名工作流一律**原地更新**：ID 不变，n8n 每次 PUT 生成新 versionId，历史可回滚。
  // 只有第一次部署才会创建。**永不自动删除**——删除不可恢复，多余件只报告。
  const list = must(await api("GET", "/api/v1/workflows?limit=250"), "列工作流");
  const byName = new Map<string, string>();
  for (const w of list.data ?? []) byName.set(String(w.name), w.id);
  const names = build().map((x) => x.wf.name);
  for (const item of build()) {
    const id = byName.get(item.wf.name);
    if (id) ids[item.key as keyof typeof ids] = id;
  }

  // 改动前先把现有定义整份落到本地，出问题能照着对照回滚
  const backup: Record<string, any> = {};
  for (const name of names) {
    const id = byName.get(name);
    if (!id) continue;
    const res = await api("GET", "/api/v1/workflows/" + id);
    if (res.status === 200 && res.body) backup[name] = res.body;
  }
  writeFileSync(
    "./film-workflow-backup.json",
    JSON.stringify({ at: new Date().toISOString(), workflows: backup }, null, 1),
    "utf8",
  );
  console.log("backup :", Object.keys(backup).length, "条已存 → film-workflow-backup.json");

  // 只创建缺失的（首次部署时互相引用还没 ID）
  for (const item of build()) {
    if (ids[item.key as keyof typeof ids]) continue;
    const created = must(await api("POST", "/api/v1/workflows", {
      name: item.wf.name, nodes: item.wf.nodes,
      connections: item.wf.connections, settings: item.wf.settings,
    }), "创建 " + item.wf.name);
    ids[item.key as keyof typeof ids] = created.id;
    console.log("created:", item.wf.name, created.id);
  }

  // 原地更新全部：ID 保持，产生新版本
  for (const key of order) {
    const item = build().find((x) => x.key === key)!;
    const id = ids[key as keyof typeof ids];
    must(await api("PUT", "/api/v1/workflows/" + id, {
      name: item.wf.name, nodes: item.wf.nodes,
      connections: item.wf.connections, settings: item.wf.settings,
    }), "更新 " + item.wf.name);
    console.log("updated:", item.wf.name, id);
  }

  // 未纳管的多余件：只报告，不删除
  const orphans = (list.data ?? [])
    .filter((w: any) => String(w.name).startsWith(FILM_PREFIX) && !names.includes(String(w.name)))
    .map((w: any) => w.id + "  " + w.name);
  if (orphans.length) {
    console.log("\n⚠️ 未纳管的多余工作流（未删除，请人工确认后处理）：");
    for (const o of orphans) console.log("   ", o);
  }

  // 最后才激活，避免半成品被定时器认领
  for (const key of order) {
    const id = ids[key as keyof typeof ids];
    const res = await api("POST", "/api/v1/workflows/" + id + "/activate");
    if (res.status === 200) console.log("active :", key, id);
    else console.log("ACTIVATE FAILED:", key, res.status,
      (res.body ? JSON.stringify(res.body) : res.raw).slice(0, 300));
  }

  writeFileSync("./film-deploy-ids.json", JSON.stringify({
    ids,
    orderPath: "frameflow-film/v1/order",
    statusPath: "frameflow-film/v1/status",
    approvePath: "frameflow-film/v1/approve",
  }, null, 1), "utf8");

  console.log("\n=== 部署完成 ===");
  console.log("下单：POST " + N8N + "/webhook/frameflow-film/v1/order");
  console.log("查状态：GET " + N8N + "/webhook/frameflow-film/v1/status?job_id=...");
}

loadEnv({ path: ".env" });
main().catch((e) => {
  console.error("部署失败：", e.message);
  process.exit(1);
});
