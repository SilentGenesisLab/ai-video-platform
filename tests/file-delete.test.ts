import { describe, it, expect, vi, beforeEach } from "vitest";
const m = vi.hoisted(() => ({ file: { id: "f", productId: "p", status: "pending" }, update: vi.fn(), audit: vi.fn(), resources: [] as any[], jobs: [] as any[] }));
vi.mock("../src/lib/auth", () => ({ requireScope: vi.fn(), productAccess: vi.fn() }));
vi.mock("../src/lib/access", () => ({ fileAccess: vi.fn(async () => m.file), conversationAccess: vi.fn() }));
vi.mock("../src/lib/services", () => ({ audit: m.audit, getResource: vi.fn(), json: (v: any) => v }));
vi.mock("../src/lib/db", () => ({ db: { $transaction: (fn: any) => fn({ resource: { findMany: async () => m.resources }, job: { findMany: async () => m.jobs }, fileObject: { update: m.update } }) } }));
import { deleteFile } from "../src/lib/storage";
const actor: any = { type: "agent", teamId: "t", permissions: ["file.read", "file.write"] };
beforeEach(() => { m.file.status = "pending"; m.resources = []; m.jobs = []; vi.clearAllMocks(); });
describe("file deletion", () => {
 it("deletes pending shell, retains object and audits; repeat is safe", async () => {
  expect(await deleteFile(actor, "f")).toEqual({ id: "f", status: "deleted" });
  expect(m.update).toHaveBeenCalledWith({ where: { id: "f" }, data: { status: "deleted" } });
  expect(m.audit).toHaveBeenCalledOnce(); m.file.status = "deleted";
  await deleteFile(actor, "f"); expect(m.update).toHaveBeenCalledOnce();
 });
 it("read only key cannot delete", async () => {
  await expect(deleteFile({ ...actor, permissions: ["file.read"] }, "f")).rejects.toThrow();
  expect(m.update).not.toHaveBeenCalled();
 });
 it("refuses current references and active tasks", async () => {
  m.resources = [{ content: { fileId: "f" } }];
  await expect(deleteFile(actor, "f")).rejects.toThrow();
  m.resources = []; m.jobs = [{ input: { fileId: "f" } }];
  await expect(deleteFile(actor, "f")).rejects.toThrow();
  expect(m.update).not.toHaveBeenCalled();
 });
});
