import { systemDb as db } from "./db";
import { teamActor, requireScope } from "./auth";
import { assert } from "./errors";
/** Recheck the original submitter immediately before an asynchronous paid call. */
export async function workerActor(teamId: string, createdBy: string) {
  let userId = createdBy,
    scopes: string[] | undefined;
  const key = await db.apiKey.findUnique({ where: { id: createdBy } });
  if (key) {
    assert(
      key.teamId === teamId &&
        key.enabled &&
        !key.revokedAt &&
        (!key.expiresAt || key.expiresAt > new Date()),
      403,
      "提交者 API Key 已失效",
    );
    userId = key.ownerId;
    scopes = key.scopes;
  }
  const run = await db.agentRun.findUnique({ where: { id: createdBy } });
  if (run) {
    assert(run.teamId === teamId, 403, "运行归属不匹配");
    userId = run.ownerId;
    scopes = run.scopes;
    if (run.sourceKeyId) {
      const k = await db.apiKey.findUnique({ where: { id: run.sourceKeyId } });
      assert(
        k &&
          k.teamId === teamId &&
          k.enabled &&
          !k.revokedAt &&
          (!k.expiresAt || k.expiresAt > new Date()),
        403,
        "原 API Key 已撤销",
      );
      scopes = scopes.filter((s) => k.scopes.includes(s));
    }
  }
  const user = await db.user.findUnique({ where: { id: userId } });
  assert(user, 403, "提交者已失效");
  const actor = await teamActor(user, teamId);
  requireScope(actor, "generate");
  assert(!scopes || scopes.includes("generate"), 403, "提交者没有模型调用权限");
  return actor;
}
