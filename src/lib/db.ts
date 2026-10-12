import { PrismaClient } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export const systemDb = globalDb.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.prisma = systemDb;
const context = new AsyncLocalStorage<string>();
export const withTeam = <T>(teamId: string, fn: () => T): T =>
  context.run(teamId, fn);
export const currentTeam = () => context.getStore();
const scoped = new Set([
  "ApiKey",
  "Resource",
  "Revision",
  "ProductionBatch",
  "Job",
  "FileObject",
  "AuditEvent",
  "Idempotency",
  "Conversation",
  "Message",
  "AgentRun",
  "AgentEvent",
  "FileAnalysis",
  "SearchRecord",
  "Wallet",
  "CreditLedger",
  "CreditQuote",
  "UsageRecord",
  "TeamInvitation",
  "TeamMember",
]);
// Trusted authentication/dispatch code uses systemDb. Authenticated business requests
// and worker executions always enter withTeam before touching these delegates.
export const db = systemDb.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const teamId = currentTeam();
        if (!teamId || !scoped.has(model)) return query(args);
        const a = args as any;
        if (
          [
            "findUnique",
            "findUniqueOrThrow",
            "findFirst",
            "findFirstOrThrow",
            "findMany",
            "count",
            "aggregate",
            "groupBy",
            "update",
            "updateMany",
            "delete",
            "deleteMany",
            "upsert",
          ].includes(operation)
        )
          a.where = { ...a.where, teamId };
        const stamp = (data: any) => {
          if (data?.teamId && data.teamId !== teamId)
            throw new Error("Cross-team write rejected");
          return { ...data, teamId };
        };
        if (operation === "create") a.data = stamp(a.data);
        if (operation === "createMany" || operation === "createManyAndReturn")
          a.data = Array.isArray(a.data) ? a.data.map(stamp) : stamp(a.data);
        if (operation === "upsert") {
          a.create = stamp(a.create);
          a.update = stamp(a.update);
        }
        if (operation === "update" || operation === "updateMany") {
          if (a.data?.teamId && a.data.teamId !== teamId)
            throw new Error("Cannot move data between teams");
        }
        return query(args);
      },
    },
  },
}) as unknown as PrismaClient;
