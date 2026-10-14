import { db } from "../lib/db";
import { assert } from "../lib/errors";
import { persistPlan } from "../lib/plan-generation";
import { workerActor } from "../lib/worker-access";
export async function generatePlan(jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  await workerActor(job.teamId, (job.input as any).createdBy);
  assert(
    process.env.N8N_PLAN_WEBHOOK_URL && process.env.N8N_PLAN_SECRET,
    503,
    "策划工作流未配置",
  );
  await db.job.update({ where: { id: jobId }, data: { status: "running" } });
  const response = await fetch(process.env.N8N_PLAN_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-aivideo-plan-secret": process.env.N8N_PLAN_SECRET,
    },
    body: JSON.stringify({ jobId }),
    signal: AbortSignal.timeout(240000),
  });
  assert(response.ok, 502, `策划工作流失败 HTTP ${response.status}`);
  const output = await response.json();
  assert(
    output.ok && output.jobId === jobId,
    502,
    "策划工作流结果无效，请查看日志状态",
  );
  await persistPlan(jobId, { ...output.plan, executionId: output.executionId });
}
