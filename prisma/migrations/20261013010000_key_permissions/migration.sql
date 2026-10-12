ALTER TABLE "ApiKey" ADD COLUMN "permissions" JSONB, ADD COLUMN "productScopeMode" TEXT NOT NULL DEFAULT 'all';
UPDATE "ApiKey" SET "productScopeMode" = 'selected' WHERE cardinality("productIds") > 0;
ALTER TABLE "AgentRun" ADD COLUMN "permissions" JSONB, ADD COLUMN "productScopeMode" TEXT NOT NULL DEFAULT 'all';
UPDATE "AgentRun" SET "productScopeMode" = 'selected' WHERE cardinality("productIds") > 0;
