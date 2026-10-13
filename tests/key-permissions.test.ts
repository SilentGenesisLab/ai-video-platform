import { describe, expect, it } from "vitest";
import {
  legacyPermissions,
  permissionIds,
  recommendedPermissions,
  requirePermission,
  scopeSummary,
  validatePermissions,
} from "../src/lib/permissions";
import { productAccess, type Actor } from "../src/lib/auth";
const actor = {
  type: "agent",
  scopes: ["read", "write", "generate"],
  permissions: ["product.read"],
  productIds: [],
  productScopeMode: "all",
} as unknown as Actor;
describe("granular Key authorization", () => {
  it("full selection never includes human administration", () => {
    expect(
      permissionIds.some((p) =>
        /approve|admin|credential|^rate\.|^key\./.test(p),
      ),
    ).toBe(false);
    expect(recommendedPermissions).not.toContain("operations.logs");
    expect(recommendedPermissions).not.toContain("operations.billing");
    expect(() => validatePermissions(permissionIds)).not.toThrow();
  });
  it("requires read dependencies and rejects fabricated permissions", () => {
    expect(() => validatePermissions(["video.generate"])).toThrow();
    expect(() =>
      validatePermissions(["video.read", "video.generate"]),
    ).not.toThrow();
    expect(() => validatePermissions(["admin.approve"])).toThrow();
    expect(() => validatePermissions([])).toThrow();
    expect(scopeSummary(["chat.read", "chat.execute"])).toEqual(
      expect.arrayContaining(["read", "write", "generate"]),
    );
  });
  it("fine permissions override the broad legacy summary", () => {
    expect(() => requirePermission(actor, "product.read")).not.toThrow();
    expect(() => requirePermission(actor, "product.write")).toThrow();
    expect(() => requirePermission(actor, "file.read")).toThrow();
    expect(legacyPermissions(["read"])).not.toContain("video.generate");
    expect(legacyPermissions(["read", "write", "generate"])).toEqual(
      permissionIds,
    );
  });
  it("explicit empty selected scope fails closed", () => {
    expect(() =>
      productAccess({ ...actor, productScopeMode: "selected" }, "anything"),
    ).toThrow();
    expect(() => productAccess(actor, "future-product")).not.toThrow();
  });
});
