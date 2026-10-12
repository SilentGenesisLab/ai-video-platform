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
        required: ["text"],
        properties: { text: { type: "string" } },
      },
    ],
    ["/agent-runs/{id}/stop", "post", "Stop a run", {}],
    ["/agent-runs/{id}/continue", "post", "Resume a run", {}],
    ["/audit-events", "get", "Read audit events"],
    ["/dashboard", "get", "Scoped counts"],
    ["/members", "get", "List members; admin only"],
    ["/members", "post", "Create member; admin only", {}],
    ["/members/{id}", "patch", "Update member; admin only", {}],
  ];
  for (const [path, method, summary, schema] of extras) {
    const full = "/api/v1" + path;
    paths[full] = {
      ...((paths[full] as object) ?? {}),
      [method]: operation(
        summary,
        schema,
        path.includes("{id}") ? [param("id")] : [],
      ),
    };
  }
  const fileList = paths["/api/v1/files"] as any;
  fileList.get.parameters = ["productId", "page", "limit"].map((p) =>
    param(p, "query"),
  );
  fileList.get.description =
    "Returns items,total,page,limit,hasMore. Defaults to 100 items, maximum 100 per page.";
  (paths["/api/v1/products/{id}"] as any).patch.description =
    "Product content is a field patch: omitted fields are preserved; supplied arrays replace that array. Structured lists have stable IDs. Editing legacy sellingPoints/audience/fileIds without corresponding structured lists can return PRODUCT_STRUCTURE_CONFLICT. Re-read and update structured fields instead.";
  return {
    openapi: "3.1.0",
    info: {
      title: "AI Video Platform",
      version: "1.1.0",
      description:
        "All create operations require Idempotency-Key. Revisions require baseVersion. Human approval is never granted to an API key. Objects and files are product-scoped. Industrial storyboards belong to plans.",
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
