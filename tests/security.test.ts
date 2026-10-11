import { beforeAll, describe, expect, it } from "vitest";
import {
  canonical,
  decrypt,
  digest,
  encrypt,
  redact,
} from "../src/lib/security";
import {
  productAccess,
  requireHuman,
  requireScope,
  type Actor,
} from "../src/lib/auth";
import { validateMagic, objectKey } from "../src/lib/storage";
const actor: Actor = {
  id: "key",
  userId: "owner",
  name: "Agent",
  type: "agent",
  role: "editor",
  scopes: ["read", "write"],
  productIds: ["allowed"],
};
beforeAll(() => {
  process.env.KEY_ENCRYPTION_SECRET = "a".repeat(64);
});
describe("credential handling", () => {
  it("authenticates encrypted credentials and detects tampering", () => {
    const encoded = encrypt("sensitive-value");
    expect(encoded).not.toContain("sensitive-value");
    expect(decrypt(encoded)).toBe("sensitive-value");
    const b = Buffer.from(encoded, "base64");
    b[30] ^= 1;
    expect(() => decrypt(b.toString("base64"))).toThrow();
  });
  it("redacts secrets recursively without removing provenance ids", () => {
    expect(
      redact({
        apiKey: "private",
        nested: { token: "secret" },
        id: "resource-123",
        error: "token avp_abcdefghijklmnopqrstuvwxyz",
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      nested: { token: "[REDACTED]" },
      id: "resource-123",
      error: "token [REDACTED]",
    });
  });
  it("snapshot hash ignores object order but preserves reference ordering", () => {
    expect(digest(canonical({ b: 2, a: 1 }))).toBe(
      digest(canonical({ a: 1, b: 2 })),
    );
    expect(digest(canonical(["a", "b"]))).not.toBe(
      digest(canonical(["b", "a"])),
    );
  });
});
describe("authorization boundaries", () => {
  it("blocks cross-product access and unscoped product creation", () => {
    expect(() => productAccess(actor, "allowed")).not.toThrow();
    expect(() => productAccess(actor, "other")).toThrow();
    expect(() => productAccess(actor)).toThrow();
  });
  it("never treats an agent as human even if its role is admin", () => {
    expect(() =>
      requireHuman({ ...actor, role: "admin", scopes: ["approve"] }),
    ).toThrow();
    expect(() => requireScope(actor, "generate")).toThrow();
  });
});
describe("storage", () => {
  it("rejects content disguised as an image", () => {
    expect(() => validateMagic(Buffer.from("<html>"), "image/png")).toThrow();
  });
  it("makes unique date-based object keys with sanitized filenames", () => {
    const a = objectKey("../name.png"),
      b = objectKey("../name.png");
    expect(a).toMatch(/^aivideo\/\d{8}\/[a-f0-9-]+\//);
    expect(a).not.toBe(b);
    expect(a.split("/")).toHaveLength(4);
  });
});
