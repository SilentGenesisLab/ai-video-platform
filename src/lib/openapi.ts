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
  const paths: Record<string, unknown> = {};
  const response = {
    description: "Success",
    content: { "application/json": { schema: { type: "object" } } },
  };
  const errors = {
    "402": {
      description: "Insufficient team credits; pause and retain progress",
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
      "/approvals/{id}",
      "post",
      "Human reviewer approves or rejects exact snapshot",
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
    ["/conversations/{id}", "get", "Messages and persisted execution status"],
    [
      "/conversations/{id}/messages",
      "post",
      "Start an agent run",
      {
        type: "object",
        properties: {
          text: { type: "string", maxLength: 30000 },
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
      "Register phone and initial team with 1000 credits",
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
    ["/billing/wallet", "get", "Current team balance and frozen credits"],
    ["/billing/usage", "get", "Team model usage and settlement basis"],
    ["/billing/ledger", "get", "Immutable team credit ledger"],
    [
      "/billing/quotes",
      "post",
      "Get ten-minute generation quote; no paid call",
      z.toJSONSchema(batchInput),
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
  return {
    openapi: "3.1.0",
    info: {
      title: "AI Video Platform",
      version: "1.3.0",
      description:
        "All create operations require Idempotency-Key. Revisions require baseVersion. Human approval is never granted to an API key. API Keys are bound to one team; sessions select the current team. Objects and files are team scoped and use product or private conversation access. Generation requires an unexpired quoteId; price changes invalidate approval. Industrial storyboards belong to plans.",
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
