# Product insights · 1.2.0

The product page is `/studio/products/{id}` with `?tab=overview|insights|brief|materials|references`.
Read `GET /api/v1/products/{id}` before editing. PATCH uses `title`, `status`, `baseVersion` and `content`; omitted product content fields are preserved. Lists supplied in a PATCH replace that list, so retain existing entries and their stable IDs when appending or reordering.

## Structured fields

- `positioning`: one-sentence positioning; `description`: product description; `brief`: Markdown source.
- `sellingPointItems`: `{id,title,feature,benefit,evidence,fileIds,sourceUrl}`.
- `audienceSegments`: `{id,name,scenario,pain,needs,objections}`.
- `userQuotes`: `{id,text,source,evidence,fileIds,sourceUrl}`. Preserve original words and distinguish inference from quotes.
- `facts`: `{id,text,kind,fileId?,source,sourceUrl}`; kind is `fact` or `hypothesis`.
- `questions`: `{id,text,note,status}`; status is `pending` or `confirmed`.
- `materials`: `{id,fileId,category,title,note}`; category is `product-image`, `product-video`, `document` or `other`.
- `referenceVideos`: `{id,title,type,fileId?,url,source,purpose,tags,hook,structure,rhythm,shots,sound,takeaways,avoid}`. For type `file`, supply an uploaded video `fileId` and an empty URL. For type `link`, supply an HTTP(S) `url` and omit `fileId`.

Generate a UUID for each new list entry. Title/name/text is required; evidence and other detail may be filled later. Use the live OpenAPI schema for validation and defaults. External source links are stored, not crawled. Referenced files must be ready and belong to this product; reference video files must have a video MIME type.

## Upload and attach

`POST /files` accepts optional `parsePolicy: "auto" | "skip"`; omitted means `auto` for compatibility. **Use `skip` for reference videos** to avoid automatic analysis. Complete the existing upload flow, then add the file ID to `materials` or `referenceVideos` in a product revision. Uploading alone does not attach it to the product's material library. Generation outputs do not automatically become product source materials.

Removing a material entry unlinks it from the current product revision; the file and historical references remain. `coverFileId` must reference an image. Store file IDs, never expiring signed URLs.

## Compatibility and pagination

The API still returns legacy `sellingPoints` (title array), `audience` (joined names) and `fileIds` (product material IDs). These are summaries of the structured fields. Old records receive a read adapter without rewriting stored revisions. Once structured fields exist, changing only a legacy summary can return `409 PRODUCT_STRUCTURE_CONFLICT`; read the latest data and update the corresponding structured list instead. Do not remove evidence to satisfy an older request format.

`GET /files?productId={id}&page=1&limit=100` returns `items,total,page,limit,hasMore`. Fetch further pages as needed.
`GET /products/{id}/context` returns `product,resources,files,pagination`. Follow `pagination.files.next` and `pagination.resources.next` while non-null; parameters are `filesPage`, `resourcesPage`, `limit` (max 100). The full product contains its material and reference associations; the file/resource arrays are paginated.

On a version conflict retain your proposed edit, read the current revision, reconcile changes, and submit with its `baseVersion`. Do not repeatedly overwrite with stale or legacy content.
