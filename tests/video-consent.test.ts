import { expect, it } from "vitest";
import { consentDetails } from "../src/lib/video-consent";
const tx: any = {
  user: {
    findUnique: async ({ where }: any) => ({ id: where.id, active: true }),
  },
  teamMember: { findUnique: async () => ({ active: true }) },
  team: { findUnique: async () => ({ archived: false }) },
};
const batch: any = {
  id: "batch",
  teamId: "team",
  createdBy: "u1",
  kind: "video",
  status: "pending_approval",
  title: "video",
  digest: "digest",
  snapshot: {
    estimatedCredits: "150",
    quoteExpiresAt: "now",
    entries: [
      {
        model: "seedance",
        prompt: "hello",
        parameters: { duration_seconds: 5 },
        channelSnapshot: { ciphertext: "secret" },
      },
    ],
  },
};
const actor: any = {
  userId: "u1",
  type: "human",
  scopes: ["read", "write", "generate"],
};
it("allows human owner editor, preserves quote, strips provider internals", async () => {
  const d = await consentDetails(actor, batch, tx);
  expect(d.canConfirm).toBe(true);
  expect(d.estimatedCredits).toBe("150");
  expect(JSON.stringify(d)).not.toContain("secret");
});
it("rejects Agent, reader and unrelated editor; keeps reviewer approval", async () => {
  expect(
    (await consentDetails({ ...actor, type: "agent" }, batch, tx)).canConfirm,
  ).toBe(false);
  expect(
    (await consentDetails({ ...actor, scopes: ["read"] }, batch, tx))
      .canConfirm,
  ).toBe(false);
  expect(
    (await consentDetails({ ...actor, userId: "u2" }, batch, tx)).canConfirm,
  ).toBe(false);
  expect(
    (
      await consentDetails(
        { ...actor, userId: "u2", scopes: ["read", "approve"] },
        batch,
        tx,
      )
    ).canConfirm,
  ).toBe(true);
});
