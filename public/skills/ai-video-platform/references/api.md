# API reference notes · v1.4.3

All business endpoints start with `/api/v1`. Use JSON request bodies, Bearer authentication, and an 8–200 character `Idempotency-Key` header on creation requests. Collection reads return `{items, total?, page?, limit?}`. Resource updates use PATCH and include `baseVersion`.

## Discover and create

1. `GET /auth/me`: identity, scopes, productIds; an empty productIds list means all products.
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
