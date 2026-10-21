# API 契约

## 1. 平台入口（推荐）

鉴权：`Authorization: Bearer <AIVIDEO_API_KEY>`。

### 下单

`POST ${AIVIDEO_BASE_URL}/api/v1/film-jobs`

```json
{
  "brief": "8~4000 字的产品描述",
  "title": "可选片名（≤80 字）",
  "product_name": "可选产品名（≤80 字）",
  "target_seconds": 40,
  "aspect_ratio": "16:9",
  "reference_image_urls": ["https://.../product.jpg"]
}
```

`target_seconds` 8~180；`aspect_ratio` ∈ `9:16 | 16:9 | 1:1 | 4:3 | 3:4`；`reference_image_urls` 最多 3 条（平台 zod 层），且值必须是 URL。

`201` 返回：

```json
{ "id": "<平台 Job id>", "pipelineJobId": "FF-20261020-AB12CD",
  "status": "pending_approval", "statusUrl": "https://n8n.../status?job_id=..." }
```

注意：平台把任务记为 `pending_approval`，但 n8n 此时还在 `planning`（写分镜）。以 `GET` 返回的 n8n `status` 为准。

### 查状态

`GET ${AIVIDEO_BASE_URL}/api/v1/film-jobs/{id}` → n8n 状态对象 + `id`、`pipelineJobId`。

### 审批

`POST ${AIVIDEO_BASE_URL}/api/v1/film-jobs/{id}/approve` → `{ ok, id, pipelineJobId }`。

只能由人类会话调用；Agent Key 403。平台自己用 `FILM_SIGNING_SECRET` 生成一次性签名链接去调 n8n。

## 2. 直连 n8n Webhook

基础地址 `FILM_WEBHOOK_BASE`（例：`https://n8n.sligenai.cn`）。

### 下单

`POST /webhook/frameflow-film/v1/order`，请求头 `X-Film-Token: <FILM_ORDER_TOKEN>`。

请求体字段同上，但 **`reference_image_urls` 必填且至少 1 条 https 直链**（平台入口的 zod 要求可选项，n8n 侧会 422）。

| 状态 | 响应 |
|---|---|
| `202` | `{ "ok": true, "job_id": "FF-...", "status": "planning", "status_url": "..." }` |
| `422` | `{ "ok": false, "error": "参数校验失败", "details": ["..."] }` |
| `401/403` | token 缺失或不匹配 |

### 查状态

`GET /webhook/frameflow-film/v1/status?job_id=FF-...`，**无需鉴权**（job_id 不可猜，且只读）。

```json
{
  "found": true,
  "job_id": "FF-20261020-AB12CD",
  "status": "generating",
  "title": "产品片 FF-...",
  "unit_count": 3,
  "units_done": 1,
  "unit_states": [
    { "index": 0, "status": "done",   "shots": 7, "seconds": 14, "video_ready": true,  "error": "" },
    { "index": 1, "status": "running","shots": 7, "seconds": 14, "video_ready": false, "error": "" }
  ],
  "result_url": "",
  "error": "",
  "updated_at": "2026-10-20T09:12:33.000Z"
}
```

`404`：`{ "ok": false, "error": "找不到该任务", "job_id": "..." }`。

### 审批

`GET /webhook/frameflow-film/v1/approve?job=<id>&decision=approve|reject&exp=<unix>&sig=<hex>`

`sig = HMAC-SHA256(FILM_SIGNING_SECRET, "job=<id>|decision=<decision>|exp=<exp>")`，hex 编码。

| 状态 | 含义 |
|---|---|
| `200` | 已受理（批准会立刻唤醒编排器） |
| `403` | 签名不匹配 / 链接过期 / `decision` 非法 |
| `409` | 任务当前状态不是 `awaiting_approval`，无需再处置 |

## 3. 平台内部合成

仅服务间调用，`x-service-secret: <INTERNAL_SERVICE_SECRET>`。

`POST ${AIVIDEO_BASE_URL}/api/v1/internal/film-assemble`

```json
{
  "segments": ["https://.../u0.mp4", "https://.../u1.mp4"],
  "music": "https://.../score.mp3",
  "targetLufs": -16,
  "limitDbtp": -1.5,
  "fadeOutSec": 2.5,
  "name": "frameflow-FF-20261020-AB12CD.mp4"
}
```

约束：`segments` 1~20 条；`targetLufs` -40~-5；`limitDbtp` -6~0；`fadeOutSec` 0~10；`music` 可省（省了只拼接、不混音）。

返回 `{ key, url, duration, bytes }`，`url` 是 7 天有效的签名地址。

内部作的事：逐段归一化（补静音轨、统一 24fps、统一分辨率并加黑边）→ 顺序拼接 → 配乐裁到片长 → 结尾淡出 → 两遍 loudnorm → 4× 过采样限幅 → 上传 OSS。成片不写数据库，平台 Job 行才是记录。

> 该路径在 Nginx 上需要单独放行（默认 `location ^~ /api/v1/internal/ { return 404; }`），见 operations.md。

## 4. 状态值

| 值 | 含义 | 会被定时器认领 |
|---|---|---|
| `planning` | 出分镜中 | 是 |
| `awaiting_approval` | 等人批，未产生费用 | 否 |
| `approved` | 已批，待派发 | 是 |
| `generating` | 逐段生成中 | 是 |
| `assembling` | 合成中 | 是 |
| `delivered` | 成片完成，`result_url` 有效 | 否 |
| `rejected` | 人工驳回 | 否 |
| `failed` | 失败，看 `error` | 否 |
