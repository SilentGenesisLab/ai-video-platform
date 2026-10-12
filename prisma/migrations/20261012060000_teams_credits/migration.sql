-- DropIndex
DROP INDEX "Idempotency_actorId_key_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "platformAdmin" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- AlterTable
ALTER TABLE "Revision" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- AlterTable
ALTER TABLE "ProductionBatch" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- AlterTable
ALTER TABLE "FileObject" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- AlterTable
ALTER TABLE "Idempotency" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "teamId" TEXT NOT NULL DEFAULT 'legacy-team';

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvitation" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "hash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsChallenge" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'sending',
    "ipHash" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "balance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "frozen" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRate" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(20,8) NOT NULL,
    "inputRate" DECIMAL(20,8),
    "cachedInputRate" DECIMAL(20,8),
    "resolution" TEXT NOT NULL DEFAULT '',
    "supplier" TEXT NOT NULL DEFAULT '',
    "basis" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditQuote" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "rateId" TEXT NOT NULL,
    "quoteLine" JSONB NOT NULL,
    "requestHash" TEXT NOT NULL,
    "reserved" DECIMAL(20,6) NOT NULL,
    "charged" DECIMAL(20,6),
    "costCny" DECIMAL(20,8),
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "costType" TEXT NOT NULL DEFAULT 'unknown',
    "upstreamId" TEXT,
    "actualSupplier" TEXT,
    "data" JSONB,
    "response" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvitation_hash_key" ON "TeamInvitation"("hash");

-- CreateIndex
CREATE INDEX "TeamInvitation_teamId_idx" ON "TeamInvitation"("teamId");

-- CreateIndex
CREATE INDEX "SmsChallenge_phone_purpose_createdAt_idx" ON "SmsChallenge"("phone", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "SmsChallenge_ipHash_createdAt_idx" ON "SmsChallenge"("ipHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_teamId_key" ON "Wallet"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditLedger_eventKey_key" ON "CreditLedger"("eventKey");

-- CreateIndex
CREATE INDEX "CreditLedger_teamId_createdAt_idx" ON "CreditLedger"("teamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRate_channelId_model_resolution_supplier_version_key" ON "PurchaseRate"("channelId", "model", "resolution", "supplier", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CreditQuote_usedBy_key" ON "CreditQuote"("usedBy");

-- CreateIndex
CREATE INDEX "CreditQuote_teamId_idx" ON "CreditQuote"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_invocationId_key" ON "UsageRecord"("invocationId");

-- CreateIndex
CREATE INDEX "UsageRecord_teamId_createdAt_idx" ON "UsageRecord"("teamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "ApiKey_teamId_idx" ON "ApiKey"("teamId");

-- CreateIndex
CREATE INDEX "Resource_teamId_idx" ON "Resource"("teamId");

-- CreateIndex
CREATE INDEX "Revision_teamId_idx" ON "Revision"("teamId");

-- CreateIndex
CREATE INDEX "ProductionBatch_teamId_idx" ON "ProductionBatch"("teamId");

-- CreateIndex
CREATE INDEX "Job_teamId_idx" ON "Job"("teamId");

-- CreateIndex
CREATE INDEX "FileObject_teamId_idx" ON "FileObject"("teamId");

-- CreateIndex
CREATE INDEX "AuditEvent_teamId_idx" ON "AuditEvent"("teamId");

-- CreateIndex
CREATE INDEX "Idempotency_teamId_idx" ON "Idempotency"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Idempotency_teamId_actorId_key_key" ON "Idempotency"("teamId", "actorId", "key");

-- CreateIndex
CREATE INDEX "Conversation_teamId_idx" ON "Conversation"("teamId");

-- CreateIndex
CREATE INDEX "Message_teamId_idx" ON "Message"("teamId");

-- CreateIndex
CREATE INDEX "AgentRun_teamId_idx" ON "AgentRun"("teamId");


-- Preserve the existing installation as one ordinary tenant.
INSERT INTO "Team" (id,name,"createdBy") VALUES ('legacy-team','原团队',COALESCE((SELECT id FROM "User" WHERE role='admin' ORDER BY "createdAt" LIMIT 1),'system')) ON CONFLICT DO NOTHING;
UPDATE "User" SET "platformAdmin"=true WHERE role='admin';
INSERT INTO "TeamMember" (id,"teamId","userId",role) SELECT 'legacy-member-'||id,'legacy-team',id,CASE WHEN id=(SELECT "createdBy" FROM "Team" WHERE id='legacy-team') THEN 'owner' ELSE role END FROM "User" ON CONFLICT DO NOTHING;
INSERT INTO "Wallet" (id,"teamId",balance,frozen,"updatedAt") VALUES ('legacy-wallet','legacy-team',1000,0,NOW()) ON CONFLICT DO NOTHING;
INSERT INTO "CreditLedger" (id,"teamId","eventKey","actorId",kind,amount,reason) VALUES ('legacy-grant','legacy-team','migration:legacy-trial','system','grant',1000,'原团队迁移赠送') ON CONFLICT DO NOTHING;
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_nonnegative CHECK (balance >= 0 AND frozen >= 0 AND frozen <= balance);
CREATE FUNCTION credit_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Credit ledger is immutable'; END $$;
CREATE TRIGGER credit_ledger_immutable BEFORE UPDATE OR DELETE ON "CreditLedger" FOR EACH ROW EXECUTE FUNCTION credit_ledger_immutable();
CREATE TRIGGER purchase_rate_immutable BEFORE UPDATE OR DELETE ON "PurchaseRate" FOR EACH ROW EXECUTE FUNCTION credit_ledger_immutable();
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "Job" ADD CONSTRAINT "Job_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "Idempotency" ADD CONSTRAINT "Idempotency_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "Message" ADD CONSTRAINT "Message_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "CreditLedger" ADD CONSTRAINT "CreditLedger_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "CreditQuote" ADD CONSTRAINT "CreditQuote_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "Session" ADD CONSTRAINT "Session_team_fk" FOREIGN KEY ("teamId") REFERENCES "Team"(id);
ALTER TABLE "TeamMember" ADD CONSTRAINT member_user_fk FOREIGN KEY ("userId") REFERENCES "User"(id);

ALTER TABLE "PurchaseRate" ADD COLUMN "pricingParameters" JSONB NOT NULL DEFAULT '{}';
