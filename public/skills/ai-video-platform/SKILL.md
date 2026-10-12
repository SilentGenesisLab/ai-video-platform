---
name: ai-video-platform
description: Manage products, briefs, creative batches, treatments, industrial storyboards, assets and production jobs in AI Video Platform. Use when the user asks to create or iterate video projects on this platform, upload materials, submit media generation, or inspect production results and provenance.
metadata:
  version: 1.4.2
---

# AI Video Platform

## Install and connect

If this document was supplied as a web link, download the sibling package at `/skills/ai-video-platform.zip` from the same platform origin. Inspect the package and extract the `ai-video-platform` folder to this Agent's supported skill directory. For Codex use `$CODEX_HOME/skills` or `~/.codex/skills`; for other hosts use their documented skill directory. Do not change unrelated Agent configuration.

Use the platform address and selected API key from the user's private connection instructions. Store them in private local configuration or the running environment as `AIVIDEO_BASE_URL` and `AIVIDEO_API_KEY`; do not put credentials in this skill or print them. Package version: **1.4.2**.

Read `references/api.md` for API conventions. Authenticate requests with `Authorization: Bearer <AIVIDEO_API_KEY>`. Call `GET /api/v1/auth/me` first and report the effective scopes and product boundary, without echoing the credential. Connection validation does not create products or trigger generation.

## Working on a project

- Read relevant product context before creating work. Product facts and original materials are distinct from interpretations; label hypotheses rather than inventing facts.
- Follow the user's requested scope. Available objects are products, creative batches, concepts, plans, storyboards, assets, scripts and deliverables. Saving a plan does not authorize paid image, video or music generation.
- Industrial storyboards belong to creative planning: one storyboard per plan, unlimited shots and immutable revisions. Contact sheets are assembled from selected shot images; they are not a replacement for the structured shot table.
- Read the current object before editing. Supply `baseVersion`. On HTTP 409 reread and reconcile human edits; never overwrite using stale content.
- Refer to assets with exact resource versions and files with platform file IDs. Preserve the order of image/video/audio references when authoring generation prompts.
- Create a production batch for requested generation. Image/audio jobs may execute immediately. Video requests enter `pending_approval`; only a human platform session can approve the snapshot. Return its ID and ask the user to review in the website. Do not look for a way to approve with the Agent key.
- Reuse the same `Idempotency-Key` for a retry of the same creation request. A new creative attempt requires a new key and, for video, fresh approval.
- Poll job status at reasonable intervals. `submission_unknown` requires reconciliation; never blindly repeat a paid provider submission. `transfer_failed` can use `retry-transfer` without regeneration.
- Report stored object IDs, versions, actual job states, and links. A submitted task is not a completed video. Preserve source links when uploading finished edits.

## Product insight workspace

Read [references/product-insights.md](references/product-insights.md) when organizing product evidence, audience segments, Briefs, materials or reference videos. Use structured fields, preserve omitted fields, and follow context/file pagination. Product reference videos are manually annotated: upload with `parsePolicy: "skip"`; do not start model analysis unless separately requested.

## Schema and discovery

Fetch `${AIVIDEO_BASE_URL}/api/v1/openapi.json` for the installed API contract. Read only relevant operations and content schemas. Public documentation contains no access credentials or business records.

Use product-scoped API queries. A restricted key cannot create a new product or access files from another product. Do not request provider credentials, member management, platform key management or human approval using the Agent key.

For installation or API updates, compare this package's version with the platform's published version. Keep local credentials outside the skill directory so package updates do not replace them.

## Conversation attachments and research

Read `references/assistant.md` for resumable streams, private uploads, video analysis and web search. Analyze only when requested; preserve source citations and timestamp uncertainty.
## Teams and credits (v1.4.2)

Your API Key is fixed to the team returned by `auth/me`. Browser team switches do not move the Key or an Agent run. Never mix object IDs, files, revisions or task references between teams. Revoked membership immediately removes access. Team administrators do not have platform administration rights.

Before every media submission, POST the exact batch payload to `/api/v1/billing/quotes`. Show the amount and line items to the user, then include the returned `quoteId` in `/production-batches`. Quotes expire in ten minutes. A changed input, changed procurement price or expired quote requires a fresh quote and, for video, fresh human approval. Never reuse an approval for regeneration. Images reserve credits when submitted; video reserves only when a human approves.

Read `/billing/wallet`, `/billing/usage` and `/billing/ledger` to inspect available/frozen credits and settlement. One RMB supplier cost is 100 credits. Missing prices use the platform default (initially 1 RMB per supplier request), explicitly labeled as estimated. /billing/wallet is the Key owner's global personal wallet; teams can allocate their pool credits to members. Browser team switches do not move the personal balance. On 402 pause and retain work; on 409 reread state before deciding whether a fresh request is appropriate. Unknown submission or cost retains frozen credits for human reconciliation. Polling, transfer retries and local storyboard overviews do not repurchase generation. Only image and video generation consume credits. Text conversations, search, attachment understanding and audio/music are free to users; supplier costs are still metered individually. New accounts receive 20000 personal credits once. Plain business reads/writes are free.
