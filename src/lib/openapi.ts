import { z } from "zod";
import { uploadSchema } from "./storage";
import {
  batchInput,
  contentSchemas,
  generationEntry,
  keyInput,
  resourceInput,
  routes,
} from "./contracts";
export function openapi() {
  const paths: Record<string, unknown> = {
    "/api/v1/concepts/{id}/generate-plan": {
      post: {
        summary:
          "Human write + generate: asynchronously create a plan through n8n. Uses immutable product/concept snapshots; text costs no personal credits. Optional draft is saved atomically with baseVersion conflict checking.",
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["baseVersion"],
                properties: {
                  baseVersion: { type: "integer", minimum: 1 },
                  draft: {
                    type: "object",
                    description:
                      "Optional title, status and content from the editor",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Queued job; poll GET /jobs/{id}. Completed result includes planId and sourceVersion.",
          },
          "409": { description: "Stale source version or an active plan job" },
        },
      },
    },
    "/api/v1/concepts/score-unscored": {
      post: {
        summary:
          "Score all unscored concepts asynchronously (human write + generate). Existing scores including zero are preserved. Optional productId limits the scope; no pagination limit.",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { productId: { type: "string", format: "uuid" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Durable scoring job; GET /jobs/{id} returns progress, skipped and failed results",
          },
          "409": { description: "Another scoring job is active" },
        },
      },
    },
  };
  const response = {
    description: "Success",
    content: { "application/json": { schema: { type: "object" } } },
  };
  const errors = {
    "402": {
      description: "Insufficient personal credits; pause and retain progress",
    },
    "429": { description: "Rate limit" },
    "401": { description: "Authentication required" },
    "403": { description: "Insufficient scope" },
    "409": { description: "Version or idempotency conflict" },
    "422": { description: "Validation error" },
  };
  const param = (name: string, location = "path") => ({
    name,
    in: location,
    required: location === "path",
    schema: { type: "string" },
  });
  const operation = (
    summary: string,
    schema?: unknown,
    parameters: unknown[] = [],
  ) => ({
    summary,
    security: [{ apiKey: [] }, { session: [] }],
    parameters,
    ...(schema
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema } },
          },
        }
      : {}),
    responses: { "200": response, ...errors },
  });
  paths["/api/v1/resources/{id}"] = {
    get: operation("Read resource with revisions", undefined, [param("id")]),
    delete: operation(
      "Archive resource without cascading deletion",
      {
        type: "object",
        required: ["baseVersion"],
        properties: { baseVersion: { type: "integer", minimum: 1 } },
      },
      [param("id"), { ...param("Idempotency-Key", "header"), required: true }],
    ),
  };
  paths["/api/v1/products/{productId}/reference-searches"] = {
    get: operation("List product reference video searches", undefined, [
      param("productId"),
    ]),
    post: operation(
      "Submit asynchronous video reference search (product.write, creative.read/generate, file.read)",
      {
        type: "object",
        required: [],
        properties: {
          imageFileId: { type: "string" },
          brief: { type: "string", maxLength: 10000 },
          depth: { enum: ["quick", "standard", "deep"] },
          targetCount: { type: "integer", minimum: 5, maximum: 200 },
          videoType: {
            enum: [
              "tvc",
              "brand",
              "ugc",
              "product",
              "story",
              "cg",
              "case",
              "review",
            ],
          },
          sources: { type: "array", items: { type: "string" } },
        },
      },
      [
        param("productId"),
        { ...param("Idempotency-Key", "header"), required: true },
      ],
    ),
  };
  paths["/api/v1/products/{productId}/reference-searches/{jobId}"] = {
    get: operation(
      "Refresh task progress and signed reference results",
      undefined,
      [param("productId"), param("jobId")],
    ),
  };
  for (const [route, kind] of Object.entries(routes)) {
    const schema = {
      ...z.toJSONSchema(resourceInput),
      properties: {
        ...z.toJSONSchema(resourceInput).properties,
        content: z.toJSONSchema(contentSchemas[kind], {
          unrepresentable: "any",
        }),
      },
    };
    paths["/api/v1/" + route] = {
      get: operation(
        "List " + route,
        undefined,
        ["productId", "planId", "parentId", "q", "page", "limit", "status"].map(
          (p) => param(p, "query"),
        ),
      ),
      post: operation("Create " + kind, schema, [
        { ...param("Idempotency-Key", "header"), required: true },
      ]),
    };
    paths["/api/v1/" + route + "/{id}"] = {
      get: operation("Read with revisions and staleSources", undefined, [
        param("id"),
      ]),
      patch: operation("Revise; baseVersion required", schema, [param("id")]),
      delete: operation(
        "Delete to archive; retain files, revisions and downstream references",
        {
          type: "object",
          required: ["baseVersion"],
          properties: { baseVersion: { type: "integer", minimum: 1 } },
        },
        [
          param("id"),
          { ...param("Idempotency-Key", "header"), required: true },
        ],
      ),
    };
  }
  paths["/api/v1/products/{id}/context"] = {
    get: operation(
      "Read structured product insights, materials and related resources; follow pagination next links",
      undefined,
      [
        param("id"),
        ...["filesPage", "resourcesPage", "limit"].map((p) =>
          param(p, "query"),
        ),
      ],
    ),
  };
  const extras: [string, string, string, unknown?][] = [
    ["/auth/me", "get", "Current identity and effective permissions"],
    [
      "/auth/profile",
      "get",
      "Own profile with masked phone and expiring avatar URL; human session only",
    ],
    [
      "/auth/profile",
      "patch",
      "Update own display name; human session only",
      z.toJSONSchema(z.object({ name: z.string().min(1).max(60) })),
    ],
    [
      "/auth/change-password",
      "post",
      "Verify current password and revoke other sessions; human session only",
      z.toJSONSchema(
        z.object({
          currentPassword: z.string(),
          password: z.string().min(12).max(72),
        }),
      ),
    ],
    [
      "/feedback",
      "get",
      "Own feedback, or current team feedback for platform administrators; human session only",
    ],
    [
      "/feedback/{id}/attachments",
      "get",
      "Short-lived attachment download links for submitter or platform administrator",
    ],
    [
      "/api-keys/options",
      "get",
      "Human-only permission catalog, dependencies and grantable permissions; optional ownerId",
    ],
    ["/api-keys", "get", "List owned platform keys; human session only"],
    [
      "/api-keys",
      "post",
      "Create scoped key; human session only",
      z.toJSONSchema(keyInput),
    ],
    [
      "/api-keys/{id}",
      "patch",
      "Update key; human session only",
      z.toJSONSchema(keyInput),
    ],
    ["/api-keys/{id}", "delete", "Revoke key; human session only"],
    [
      "/api-keys/{id}/rotate",
      "post",
      "Rotate and immediately revoke old credential",
      {},
    ],
    [
      "/api-keys/{id}/connection-instructions",
      "post",
      "Copy installation instructions; sensitive no-store response",
      {},
    ],
    ["/channels", "get", "Available models and capabilities"],
    ["/channels", "post", "Configure provider; human admin only", {}],
    ["/channels/{id}", "patch", "Update provider; human admin only", {}],
    ["/files", "get", "List product files"],
    ["/files", "post", "Prepare signed upload", z.toJSONSchema(uploadSchema)],
    ["/files/{id}", "get", "File metadata and expiring read URL"],
    [
      "/files/{id}/complete",
      "post",
      "Validate uploaded file; schedule parsing unless parsePolicy is skip",
      {},
    ],
    ["/files/{id}/upload-url", "post", "Renew expired staging PUT URL", {}],
    ["/files/{id}/retry-parse", "post", "Retry failed material extraction", {}],
    [
      "/production-batches",
      "post",
      "Submit immutable generation batch; video awaits human approval",
      z.toJSONSchema(batchInput),
    ],
    ["/production-batches", "get", "List batches"],
    ["/production-batches/{id}", "get", "Batch snapshot and jobs"],
    [
      "/production-batches/{id}/refresh-quote",
      "post",
      "Human owner (write + generate) or reviewer refreshes pending video cost quote without freezing credits or submitting generation; returns digest and estimatedCredits for explicit consent",
      {},
    ],
    [
      "/approvals/{id}",
      "post",
      "Human owner (write + generate) or reviewer consents to exact video snapshot and quoted credits; approval freezes credits and enqueues once. Agents cannot consent.",
      {
        type: "object",
        required: ["digest", "decision"],
        properties: {
          digest: { type: "string" },
          decision: { enum: ["approve", "reject"] },
        },
      },
    ],
    ["/jobs", "get", "List jobs"],
    [
      "/jobs/{id}",
      "get",
      "Job, input provenance, output files and provider state",
    ],
    ["/jobs/{id}/cancel", "post", "Request cancellation", {}],
    [
      "/jobs/{id}/retry-transfer",
      "post",
      "Retry storage only; never regenerate",
      {},
    ],
    [
      "/jobs/{id}/reconcile",
      "post",
      "Human reviewer links a verified provider task after an uncertain submission",
      {
        type: "object",
        required: ["upstreamId"],
        properties: { upstreamId: { type: "string" } },
      },
    ],
    [
      "/storyboards/{id}/convert-act",
      "post",
      "Convert one saved act to a draft video script, retaining storyboard and asset versions; no paid generation",
      {
        type: "object",
        required: ["baseVersion", "actId"],
        properties: {
          baseVersion: { type: "integer", minimum: 1 },
          actId: { type: "string" },
        },
      },
    ],
    [
      "/storyboards/{id}/overview",
      "post",
      "Build deterministic contact sheets from selected shot images",
      {},
    ],
    ["/conversations", "get", "List conversations"],
    [
      "/conversations",
      "post",
      "Create scoped conversation",
      {
        type: "object",
        properties: {
          title: { type: "string" },
          productId: { type: "string" },
          planId: { type: "string" },
        },
      },
    ],
    [
      "/conversations/{id}/media",
      "get",
      "Conversation media batches and signed results",
    ],
    [
      "/tools/generate-media",
      "post",
      "Direct media submission with automatic channel and quote",
      {
        type: "object",
        required: ["kind", "productId", "prompt"],
        properties: {
          kind: { type: "string", enum: ["image", "video"] },
          productId: { type: "string", format: "uuid" },
          planId: { type: "string" },
          prompt: { type: "string" },
          title: { type: "string" },
          count: { type: "integer", minimum: 1, maximum: 20 },
          referenceFileIds: { type: "array", items: { type: "string" } },
          targetResourceId: { type: "string" },
          parameters: { type: "object", additionalProperties: true },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                resourceId: { type: "string" },
                version: { type: "integer" },
              },
            },
          },
        },
      },
    ],
    ["/conversations/{id}", "get", "Messages and persisted execution status"],
    [
      "/conversations/{id}/messages",
      "post",
      "Start an agent run",
      {
        type: "object",
        properties: {
          text: { type: "string", maxLength: 30000 },
          referenceIds: {
            type: "array",
            maxItems: 10,
            items: { type: "string", format: "uuid" },
          },
          attachmentIds: {
            type: "array",
            items: { type: "string" },
            maxItems: 10,
          },
        },
      },
    ],
    [
      "/conversations/{id}/events",
      "get",
      "SSE events. Resume with Last-Event-ID or after cursor; snapshot includes a consistent cursor.",
    ],
    [
      "/conversations/{id}/imports",
      "post",
      "Import a public HTTPS video file into the conversation (not a sharing page)",
      {
        type: "object",
        required: ["url"],
        properties: { url: { type: "string", format: "uri" } },
      },
    ],
    [
      "/files/{id}/content",
      "get",
      "Read attachment text in pages; cursor defaults 0, limit defaults 8000 (max 16000). Includes source sections.",
    ],
    [
      "/files/{id}/analyses",
      "get",
      "List authorized video analysis results and attempt states",
    ],
    [
      "/files/{id}/analyses",
      "post",
      "Analyze video using Doubao; identical file/model/prompt requests reuse the existing task",
      {
        type: "object",
        properties: { prompt: { type: "string", maxLength: 30000 } },
      },
    ],
    [
      "/files/{id}/save-to-product",
      "post",
      "Copy an attachment into product materials with an immutable revision",
      {
        type: "object",
        required: ["productId", "baseVersion"],
        properties: {
          productId: { type: "string" },
          baseVersion: { type: "integer", minimum: 1 },
        },
      },
    ],
    [
      "/tools/web-search",
      "post",
      "Bocha search; write scope and idempotency key required. Cite returned URLs.",
      {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", maxLength: 1500 },
          freshness: {
            type: "string",
            enum: ["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"],
            default: "noLimit",
          },
          count: { type: "integer", minimum: 1, maximum: 10, default: 10 },
        },
      },
    ],
    ["/agent-runs/{id}/stop", "post", "Stop a run", {}],
    ["/agent-runs/{id}/continue", "post", "Resume a run", {}],
    ["/audit-events", "get", "Read audit events"],
    ["/dashboard", "get", "Scoped counts"],
    ["/members", "get", "List members; admin only"],
  ];
  const phone = {
    type: "string",
    description: "China mainland +86 phone number",
  };
  const str = { type: "string" };
  const obj = (properties: any, required: string[] = []) => ({
    type: "object",
    properties,
    required,
  });
  extras.push(
    [
      "/auth/login",
      "post",
      "Email or phone password login",
      obj({ email: str, phone, identifier: str, password: str }, ["password"]),
    ],
    [
      "/auth/sms",
      "post",
      "Send purpose-bound SMS code; 60s cooldown",
      obj(
        { phone, purpose: { enum: ["register", "login", "reset", "bind"] } },
        ["phone", "purpose"],
      ),
    ],
    [
      "/auth/register",
      "post",
      "Register phone and initial team with 20000 personal credits",
      obj(
        {
          phone,
          code: str,
          name: str,
          password: { type: "string", minLength: 12, maxLength: 72 },
        },
        ["phone", "code", "name", "password"],
      ),
    ],
    [
      "/auth/otp-login",
      "post",
      "Login existing phone account",
      obj({ phone, code: str }, ["phone", "code"]),
    ],
    [
      "/auth/reset-password",
      "post",
      "Reset password and revoke all sessions",
      obj({ phone, code: str, password: str }, ["phone", "code", "password"]),
    ],
    [
      "/auth/bind-phone",
      "post",
      "Bind verified phone to current human account",
      obj({ phone, code: str }, ["phone", "code"]),
    ],
    ["/teams", "get", "List human memberships and balances"],
    [
      "/teams",
      "post",
      "Create additional team without a credit grant",
      obj({ name: str }, ["name"]),
    ],
    [
      "/teams/{id}",
      "patch",
      "Rename or archive a team",
      obj({ name: str, archived: { type: "boolean" } }),
    ],
    ["/teams/{id}/switch", "post", "Change current human session team", {}],
    ["/teams/{id}/members", "get", "List team members"],
    [
      "/teams/{id}/members/{memberId}",
      "patch",
      "Change role or revoke membership immediately",
      obj({
        role: { enum: ["admin", "editor", "reviewer", "viewer"] },
        active: { type: "boolean" },
      }),
    ],
    ["/teams/{id}/invitations", "get", "List team invitations"],
    [
      "/teams/{id}/invitations",
      "post",
      "Create single-use phone-bound seven-day invitation",
      obj(
        { phone, role: { enum: ["admin", "editor", "reviewer", "viewer"] } },
        ["phone"],
      ),
    ],
    ["/teams/{id}/invitations/{invitationId}", "delete", "Revoke invitation"],
    ["/invitations/{id}", "get", "Inspect invitation token for matching phone"],
    ["/invitations/{id}", "post", "Accept invitation; grants no credits", {}],
    [
      "/billing/wallet",
      "get",
      "Current user global personal balance and frozen credits",
    ],
    [
      "/billing/usage",
      "get",
      "Current user's global usage: teamId, payerKind, payerUserId, rateId and immutable quoteLine; Agent keys remain limited to their own team",
    ],
    ["/billing/ledger", "get", "Current user immutable personal credit ledger"],
    [
      "/billing/quotes",
      "post",
      "Get ten-minute generation quote; no paid call",
      z.toJSONSchema(batchInput),
    ],
    ["/teams/{id}/wallet", "get", "Team shared pool balance"],
    ["/teams/{id}/usage", "get", "Team manager: usage within this team"],
    [
      "/teams/{id}/credit-allocations",
      "get",
      "Team manager: allocation ledger",
    ],
    [
      "/teams/{id}/credit-allocations",
      "post",
      "Transfer pool credits to a member personal wallet",
      obj(
        {
          userId: str,
          amount: { type: "number", exclusiveMinimum: 0 },
          reason: str,
          eventKey: str,
        },
        ["userId", "amount", "reason", "eventKey"],
      ),
    ],
    [
      "/platform/users",
      "get",
      "Platform admin: paginated users; q/page query parameters",
    ],
    [
      "/platform/users",
      "post",
      "Platform admin: create account",
      obj(
        {
          name: str,
          email: str,
          password: str,
          platformAdmin: { type: "boolean" },
        },
        ["name", "email", "password"],
      ),
    ],
    [
      "/platform/users/{id}",
      "get",
      "Platform admin: user wallet, teams and usage",
    ],
    [
      "/platform/users/{id}",
      "patch",
      "Platform admin: edit name, status and admin role",
      obj({
        name: str,
        active: { type: "boolean" },
        platformAdmin: { type: "boolean" },
      }),
    ],
    [
      "/platform/users/{id}/reset-password",
      "post",
      "Platform admin: reset password and invalidate sessions",
      obj({ password: str }, ["password"]),
    ],
    [
      "/platform/dashboard",
      "get",
      "Platform admin: days/from/to/teamId/actorId/channelId/model filters",
    ],
    [
      "/platform/overview",
      "get",
      "Platform admin: Shanghai daily registrations, model invocations and charged credits; fourteen-day trend and recent failed calls",
    ],
    [
      "/platform/rates/confirm-current",
      "post",
      "Platform admin: confirm current configured prices with new immutable verified versions; preserve historical rates",
    ],
    [
      "/platform/settings",
      "get",
      "Platform admin: default estimated request price",
    ],
    [
      "/platform/settings",
      "patch",
      "Platform admin: change fallback CNY",
      obj({ fallbackCny: { type: "number", exclusiveMinimum: 0 } }, [
        "fallbackCny",
      ]),
    ],
    [
      "/platform/personal-credits",
      "post",
      "Platform admin: adjust personal wallet with reason",
      obj(
        { userId: str, amount: { type: "number" }, reason: str, eventKey: str },
        ["userId", "amount", "reason", "eventKey"],
      ),
    ],
    ["/platform/rates", "get", "Platform admin: procurement price versions"],
    [
      "/platform/rates/official-deepseek",
      "post",
      "Platform admin: initialize missing verified DeepSeek CNY ceiling rates without overwriting existing prices",
      obj({}),
    ],
    [
      "/platform/rates",
      "post",
      "Platform admin: append RMB procurement price",
      obj(
        {
          channelId: str,
          model: str,
          kind: {
            enum: [
              "text",
              "vision",
              "image",
              "video",
              "audio",
              "video_understanding",
              "search",
            ],
          },
          unit: { enum: ["token", "image", "second", "request"] },
          rate: { type: "number", exclusiveMinimum: 0 },
          inputRate: { type: "number", minimum: 0 },
          cachedInputRate: { type: "number", minimum: 0 },
          resolution: str,
          supplier: str,
          pricingParameters: { type: "object", additionalProperties: true },
          sourceUrl: str,
          checkedAt: { type: "string", format: "date-time" },
          billingSchedule: {
            type: "object",
            description:
              "Asia/Shanghai peakWeekdays, peakHours in minutes, holidayDates and offPeakMultiplier",
          },
          basis: str,
        },
        ["channelId", "model", "kind", "unit", "rate", "basis"],
      ),
    ],
    ["/platform/teams", "get", "Platform admin: all team states and wallets"],
    [
      "/platform/teams/{id}",
      "patch",
      "Platform admin: archive or restore team",
      obj({ archived: { type: "boolean" } }, ["archived"]),
    ],
    [
      "/platform/credits",
      "post",
      "Platform admin: idempotent credit adjustment",
      obj(
        { teamId: str, amount: { type: "number" }, reason: str, eventKey: str },
        ["teamId", "amount", "reason", "eventKey"],
      ),
    ],
    ["/platform/reconcile", "get", "Platform admin: uncertain costs"],
    [
      "/platform/reconcile/{id}",
      "post",
      "Platform admin: confirmed RMB cost settlement",
      obj({ costCny: { type: "number", minimum: 0 }, reason: str }, [
        "costCny",
        "reason",
      ]),
    ],
  );
  for (const [path, method, summary, schema] of extras) {
    const full = "/api/v1" + path;
    paths[full] = {
      ...((paths[full] as object) ?? {}),
      [method]: operation(
        summary,
        schema,
        Array.from(path.matchAll(/\{([^}]+)\}/g), (m) => param(m[1])),
      ),
    };
  }
  for (const [path, value] of Object.entries(paths)) {
    for (const op of Object.values(value as any) as any[]) {
      if (path.match(/\/auth\/(sms|register|otp-login|login|reset-password)$/))
        op.security = [];
      else if (
        path.match(/\/(teams|invitations|platform|members)(\/|$)/) ||
        path.endsWith("/auth/bind-phone")
      )
        op.security = [{ session: [] }];
    }
  }
  const fileList = paths["/api/v1/files"] as any;
  fileList.get.parameters = [
    "productId",
    "conversationId",
    "page",
    "limit",
  ].map((p) => param(p, "query"));
  fileList.get.description =
    "Returns items,total,page,limit,hasMore. Defaults to 100 items, maximum 100 per page.";
  (paths["/api/v1/products/{id}"] as any).patch.description =
    "Product content is a field patch: omitted fields are preserved; supplied arrays replace that array. Structured lists have stable IDs. Editing legacy sellingPoints/audience/fileIds without corresponding structured lists can return PRODUCT_STRUCTURE_CONFLICT. Re-read and update structured fields instead.";
  (paths["/api/v1/conversations/{id}/events"] as any).get.responses["200"] = {
    description: "Authenticated resumable SSE",
    content: { "text/event-stream": { schema: { type: "string" } } },
  };
  for (const [path, params] of [
    ["/api/v1/conversations/{id}/events", [param("after", "query")]],
    [
      "/api/v1/files/{id}/content",
      [param("cursor", "query"), param("limit", "query")],
    ],
  ] as const)
    (paths[path] as any).get.parameters.push(...params);
  for (const [path, summary, properties] of [
    [
      "/api/v1/auth/avatar",
      "Upload own avatar (PNG/JPEG/WebP, at most 512KB); human session only",
      { file: { type: "string", format: "binary" } },
    ],
    [
      "/api/v1/feedback",
      "Submit feedback with at most 3 attachments, each at most 5MB; human session only",
      {
        type: {
          type: "string",
          enum: ["产品建议", "问题反馈", "使用咨询", "其他"],
        },
        content: { type: "string", minLength: 5, maxLength: 2000 },
        files: {
          type: "array",
          maxItems: 3,
          items: { type: "string", format: "binary" },
        },
      },
    ],
  ] as const) {
    paths[path] = {
      ...((paths[path] as object) ?? {}),
      post: {
        ...operation(summary),
        security: [{ session: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties,
                required: path.endsWith("avatar")
                  ? ["file"]
                  : ["type", "content"],
              },
            },
          },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "AI Video Platform",
      version: "1.5.3",
      description:
        "All create operations require Idempotency-Key. Revisions require baseVersion. Human approval is never granted to an API key. API Keys enforce module permissions and explicit productScopeMode (all includes future team products, selected requires productIds). Legacy scopes remain summaries, and incompatible legacy authorization edits return 409. API Keys are bound to one team; sessions select the current team. Objects and files are team scoped and use product or private conversation access. Generation requires an unexpired quoteId; price changes invalidate approval. Industrial storyboards belong to plans.",
    },
    servers: [{ url: process.env.APP_URL ?? "http://localhost:3000" }],
    paths,
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer" },
        session: { type: "apiKey", in: "cookie", name: "av_session" },
      },
      schemas: { GenerationEntry: z.toJSONSchema(generationEntry) },
    },
  };
}
