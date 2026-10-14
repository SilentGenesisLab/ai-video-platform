# API reference notes · v1.5.2

All business endpoints start with `/api/v1`. Use JSON request bodies, Bearer authentication, and an 8–200 character `Idempotency-Key` header on creation requests. Collection reads return `{items, total?, page?, limit?}`. Resource updates use PATCH and include `baseVersion`.

## Discover and create

1. `GET /auth/me`: identity, effective permissions, legacy scopes, productScopeMode and productIds. Mode all includes future team products; selected permits only its nonempty productIds. For legacy keys without a mode, only an empty productIds list denotes all.
2. `GET /products` and `GET /products/{id}/context`: select a product and obtain its brief, materials, related resources.
3. `POST /creative-batches`: `{title,productId,content:{requirements,count}}`.
4. `POST /concepts`: `{title,productId,parentId:<batchId>,content:{hook,idea,structure,emotion,selfReview,comments}}`.
5. `POST /plans`: `{title,productId,parentId:<conceptId>,content:{objective,audience,message,story,visualStyle,sound,duration,aspectRatio,body}}`.
6. `POST /storyboards`: `{title,productId,planId,content:{shots:[...]}}`. Each shot has a stable `id`, unique `number`, `duration`, `description`, framing/camera/movement/action/dialogue/sound/continuity, `assets:[{resourceId,version}]`, optional imageFileId, and candidateFileIds.
7. `POST /assets` and `/scripts`: consult the relevant OpenAPI content schema. Optional `sources:[{resourceId,version}]` records exact upstream versions.

The resource response contains its ID and version. `GET /{collection}/{id}` additionally returns revisions and staleSources. Editing an object's product or parent is not supported; create a new resource if a new branch is needed.

## Files

`POST /files` with `{productId,name,mime,bytes}` returns a file record and a signed PUT uploadUrl. Upload the exact file with the returned Content-Type header, then call `POST /files/{id}/complete` with `{}`. This validates content, computes its hash and schedules extraction. `GET /files/{id}` returns metadata and a renewable read URL. Use file IDs in saved documents, not expiring URLs. Maximum file size is 512 MiB.

## Production

`GET /channels` discovers supported models and channel IDs without credentials.

`POST /production-batches`:

```json
{
  "title": "Product hero shot",
  "productId": "PRODUCT_ID",
  "planId": "PLAN_ID",
  "kind": "video",
  "entries": [
    {
      "channelId": "CHANNEL_ID",
      "model": "seedance-2.5",
      "channel": "auto",
      "prompt": "Describe the agreed shot and reference order here.",
      "referenceFileIds": ["FILE_ID"],
      "sources": [{ "resourceId": "SCRIPT_ID", "version": 1 }],
      "targetResourceId": "SCRIPT_ID",
      "parameters": {
        "duration_seconds": 5,
        "resolution": "720p",
        "aspect_ratio": "16:9",
        "sound": false
      }
    }
  ]
}
```

`kind` is image, video or audio. The batch snapshot is immutable. To revise it, submit a new batch. For image assets use targetResourceId; for storyboard images also provide targetShotId.

Query `/production-batches/{id}` and `/jobs/{id}`. Completed job `result.files` contains platform file IDs. Use them to revise the corresponding asset selectedFileId or storyboard shot imageFileId. Save human decisions and new versions rather than replacing old results.

`POST /storyboards/{id}/overview` schedules a deterministic contact sheet. It returns a job whose output files can be viewed with `/files/{id}`.

`POST /jobs/{id}/cancel` requests cancellation; the actual outcome may still be pending. `POST /jobs/{id}/retry-transfer` applies only to transfer_failed tasks with an existing provider ID.

## Errors

- 401: missing, expired, rotated or revoked credentials; obtain a valid key from the human.
- 403: scope or product boundary violation; do not try alternate endpoints to bypass it.
- 409: reread current content and reconcile, or retain the original request body for an idempotency retry.
- 422: inspect field validation errors and adjust parameters.
- 429/5xx: bounded backoff on reads; for writes reuse the original idempotency key. Never infer an upstream generation failed to start from a network timeout.

## Quote before submission

```js
const quote = await platform("/billing/quotes", "POST", batch);
// Present quote.amount, quote.lines and quote.expiresAt before submitting.
const result = await platform("/production-batches", "POST", {
  ...batch,
  quoteId: quote.id,
});
```

API keys cannot use `/teams`, `/invitations`, `/platform`, phone binding, human approvals or key management. The website's team switch does not change your key's team. `auth/me` includes `teamId`, `teamName`, `teamRole`, `scopes` and product boundaries. Capture that context before using existing object IDs.

`GET /api/v1/billing/usage` 返回个人跨团队用量及 `teamId`、`payerKind`、`payerUserId`、`rateId` 和不可变 `quoteLine`；Agent Key 只能查看自身团队中的个人用量。

## Delete and restore

`DELETE /{collection}/{id}` (or `/resources/{id}`) accepts `{ "baseVersion": 1 }` and requires an `Idempotency-Key`. Supported collections: products, creative-batches, concepts, plans, storyboards, assets, scripts, deliverables. The applicable module write permission and product scope are checked on every request, including replays. Deletion archives only the selected object, adds an immutable revision and audit event, and retains files, sources, downstream objects and running tasks. Stale versions return 409. Read archived objects with `status=archived`; restore through PATCH with the latest baseVersion, preserved content and an active status. Do not issue cascading deletes unless the human explicitly requests them.

## Reference video retrieval

POST /products/{productId}/reference-searches with Idempotency-Key and {imageFileId,brief,depth:"standard",targetCount:30,videoType:"tvc"}. The image must be a ready JPG/PNG/WebP from this product, at most 15MB. GET the collection to see product search history; GET /products/{productId}/reference-searches/{jobId} every 5 seconds to refresh progress and signed results. Jobs persist across browser reloads. An uncertain submission is never automatically resubmitted. Result.run.dimensions[].videos contain stable source URLs, titles, scores and reference notes inferred from metadata; verify by watching the actual video. Add chosen references through a normal versioned product PATCH using content.referenceVideos, preserving all existing fields. Supplier credentials and other products' upstream task IDs cannot be supplied by clients.

## 人类一键生成策划案

`POST /api/v1/concepts/{id}/generate-plan`，参数 `{"baseVersion":1}`，返回异步 Job。仅人类登录且具有制作权限可提交；读取 `GET /api/v1/jobs/{jobId}`，成功结果包含 `planId`。该入口走 n8n 工作流，文本不扣个人积分。Agent 可继续按普通策划案写入接口保存自己的方案。
