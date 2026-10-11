---
name: ai-video-platform
description: Manage products, briefs, creative batches, treatments, industrial storyboards, assets and production jobs in AI Video Platform. Use when the user asks to create or iterate video projects on this platform, upload materials, submit media generation, or inspect production results and provenance.
metadata:
  version: 1.0.0
---

# AI Video Platform

## Install and connect

If this document was supplied as a web link, download the sibling package at `/skills/ai-video-platform.zip` from the same platform origin. Inspect the package and extract the `ai-video-platform` folder to this Agent's supported skill directory. For Codex use `$CODEX_HOME/skills` or `~/.codex/skills`; for other hosts use their documented skill directory. Do not change unrelated Agent configuration.

Use the platform address and selected API key from the user's private connection instructions. Store them in private local configuration or the running environment as `AIVIDEO_BASE_URL` and `AIVIDEO_API_KEY`; do not put credentials in this skill or print them. Package version: **1.0.0**.

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

## Schema and discovery

Fetch `${AIVIDEO_BASE_URL}/api/v1/openapi.json` for the installed API contract. Read only relevant operations and content schemas. Public documentation contains no access credentials or business records.

Use product-scoped API queries. A restricted key cannot create a new product or access files from another product. Do not request provider credentials, member management, platform key management or human approval using the Agent key.

For installation or API updates, compare this package's version with the platform's published version. Keep local credentials outside the skill directory so package updates do not replace them.
