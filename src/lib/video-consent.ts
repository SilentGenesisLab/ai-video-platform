import type { Actor } from "./auth";
import type { Tx } from "./services";
import { payerUser } from "./personal-credits";
import { assert } from "./errors";
type Batch = {
  createdBy: string;
  teamId: string;
  snapshot: unknown;
  digest: string;
  id: string;
  title: string;
  kind: string;
  status: string;
};
export async function consentDetails(actor: Actor, batch: Batch, tx: Tx) {
  let own = false;
  try {
    own = (await payerUser(tx, batch.createdBy, batch.teamId)) === actor.userId;
  } catch {
    /* Invalid payer cannot consent. */
  }
  const snapshot = batch.snapshot as any;
  return {
    id: batch.id,
    title: batch.title,
    kind: batch.kind,
    status: batch.status,
    digest: batch.digest,
    estimatedCredits: snapshot.estimatedCredits,
    quoteExpiresAt: snapshot.quoteExpiresAt,
    count: snapshot.entries.length,
    entries: snapshot.entries.map((e: any) => ({
      model: e.model,
      prompt: e.prompt,
      parameters: e.parameters,
    })),
    payerIsCurrentUser: own,
    canConfirm:
      actor.type === "human" &&
      (actor.scopes.includes("approve") ||
        (own &&
          actor.scopes.includes("write") &&
          actor.scopes.includes("generate"))),
  };
}
export async function requireConsent(actor: Actor, batch: Batch, tx: Tx) {
  const details = await consentDetails(actor, batch, tx);
  assert(
    details.canConfirm,
    403,
    "仅人类发起人或有审批权限的成员可确认生成",
    "HUMAN_CONSENT_REQUIRED",
  );
  return details;
}
