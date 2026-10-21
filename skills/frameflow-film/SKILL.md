---
name: frameflow-film
description: Submit, approve and track Frameflow Film video jobs on the n8n pipeline — a product brief becomes a storyboard, segmented Seedance generation, Suno score and a finished MP4 assembled by the AI Video Platform. Use when the user wants to turn a product description into a finished short video, check on a film job, or operate/deploy the underlying n8n workflows.
metadata:
  version: 1.0.0
---

# Frameflow Film

产品描述 → 分镜 → 分段生成 → 配乐 → 成片。n8n 负责规划、逐段生成和配乐；**平台负责最后合成**（ffmpeg 在平台镜像里，不经过任何外部内核，成本为 0）。

两条入口，选一条：

- **平台入口（推荐）**：`POST ${AIVIDEO_BASE_URL}/api/v1/film-jobs`。平台负责鉴权、团队隔离、人工审批闸门和状态聚合。需要普通平台 API Key。
- **直连 n8n（仅内部运维）**：`POST ${FILM_WEBHOOK_BASE}/webhook/frameflow-film/v1/order`，带 `X-Film-Token`。绕过了平台的审批界面，只有在自己写运维脚本时才用。

凭据只放在运行时环境或私有配置里，不要写进本 skill、不要打印：`AIVIDEO_BASE_URL`、`AIVIDEO_API_KEY`（平台入口），`FILM_WEBHOOK_BASE`、`FILM_ORDER_TOKEN`、`FILM_SIGNING_SECRET`（直连入口）。

## 下单前

- 产品描述 8~4000 字。`target_seconds` 取 8~180，默认 40。`aspect_ratio` 只能是 `9:16` / `16:9` / `1:1` / `4:3` / `3:4`。
- **必须提供产品参考图直链**（`reference_image_urls`，https）。没有产品图的请求一律 422，不做生成。平台入口上游 `zod` 限制为 3 张，n8n 侧上限 6 张。
- 下单本身**不产生费用**：只做分镜规划。看到 202 或 201 不等于已经开始花钱。

## 状态机与轮询

`planning` → `awaiting_approval` → `approved` → `generating` → `assembling` → `delivered`；另有 `rejected` / `failed`。

- `planning` 结束后停在 `awaiting_approval`，**批准之前不调用任何付费模型**。
- 终态是 `delivered` / `failed` / `rejected`。轮询间隔建议 ≥60 秒，到终态就停。
- 想判断「是否卡住」：n8n 每 2 分钟认领 `planning` / `approved` / `generating` / `assembling`；`awaiting_approval` 不被认领，因为它本来就在等人。

## 审批

审批是**人类动作**。用 Agent Key 调 `POST /api/v1/film-jobs/{id}/approve` 会被 403 `requireHuman` 拦下 —— 这是设计，不要找别的路径绕过。

直连场景下审批走签名链接：`GET .../approve?job=<id>&decision=approve|reject&exp=<unix>&sig=<hmac>`，`sig = HMAC-SHA256(secret, "job=<id>|decision=<decision>|exp=<exp>")`。链接 7 天过期，签名不符或过期一律 403。

批准后立即开始逐段生成；驳回不产生任何调用。

## 成本与重试

- 一段 40 秒片 ≈ 3 个生成单元 = **3 次视频请求 + 1 次 Suno 配乐请求**；合成 0 元。批准前 0 元。
- 失败看 `error` 字段。`failed` 任务不要当成偶发故障反复重提 —— 先读错误；重提是一次新的付费请求。
- 每段自带 `video_url`，单元级完成不代表成片可交付：只有 `result_url` 非空才是成片。

## 参考

- 请求/响应字段、状态字段、错误码：[references/api.md](references/api.md)
- 7 条工作流、部署、凭据、心跳与排障：[references/operations.md](references/operations.md)

## 报告给用户

给 `job_id`、当前 `status`、`units_done / unit_count`、`result_url`（如果有）和 `error`（如果有）。成片链接是 7 天有效的签名 URL，需要长期保存就让用户自己转存。
