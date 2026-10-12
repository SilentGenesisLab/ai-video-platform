CREATE TABLE "UserWallet" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL UNIQUE REFERENCES "User"(id),"balance" DECIMAL(20,6) NOT NULL DEFAULT 0,"frozen" DECIMAL(20,6) NOT NULL DEFAULT 0,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT personal_wallet_nonnegative CHECK(balance>=0 AND frozen>=0 AND frozen<=balance));
CREATE TABLE "PersonalCreditLedger" ("id" TEXT PRIMARY KEY,"userId" TEXT NOT NULL REFERENCES "User"(id),"sourceTeamId" TEXT,"eventKey" TEXT NOT NULL UNIQUE,"actorId" TEXT NOT NULL,"kind" TEXT NOT NULL,"amount" DECIMAL(20,6) NOT NULL,"reason" TEXT NOT NULL,"referenceId" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "PersonalCreditLedger_userId_createdAt_idx" ON "PersonalCreditLedger"("userId","createdAt");
CREATE TRIGGER personal_credit_ledger_immutable BEFORE UPDATE OR DELETE ON "PersonalCreditLedger" FOR EACH ROW EXECUTE FUNCTION credit_ledger_immutable();
CREATE TABLE "PlatformSetting" ("id" TEXT PRIMARY KEY,"fallbackCny" DECIMAL(20,8) NOT NULL DEFAULT 1 CHECK("fallbackCny">0),"updatedBy" TEXT,"updatedAt" TIMESTAMP(3) NOT NULL);
INSERT INTO "PlatformSetting" (id,"updatedAt") VALUES ('main',CURRENT_TIMESTAMP);
INSERT INTO "UserWallet" (id,"userId","updatedAt") SELECT 'personal-'||id,id,CURRENT_TIMESTAMP FROM "User";
ALTER TABLE "UsageRecord" ADD COLUMN "payerKind" TEXT NOT NULL DEFAULT 'team', ADD COLUMN "payerUserId" TEXT;
ALTER TABLE "PurchaseRate" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'verified', ADD COLUMN "sourceUrl" TEXT, ADD COLUMN "checkedAt" TIMESTAMP(3);
-- Preserve all existing frozen funds and immutable historical entries.
DO $$
DECLARE target_user TEXT; amount DECIMAL(20,6);
BEGIN
 SELECT id INTO target_user FROM "User" WHERE "platformAdmin"=true AND active=true ORDER BY "createdAt" LIMIT 1;
 SELECT LEAST(1000,balance-frozen) INTO amount FROM "Wallet" WHERE "teamId"='legacy-team' FOR UPDATE;
 IF target_user IS NOT NULL AND amount>0 THEN
  UPDATE "Wallet" SET balance=balance-amount,"updatedAt"=CURRENT_TIMESTAMP WHERE "teamId"='legacy-team';
  UPDATE "UserWallet" SET balance=balance+amount,"updatedAt"=CURRENT_TIMESTAMP WHERE "userId"=target_user;
  INSERT INTO "CreditLedger" (id,"teamId","eventKey","actorId",kind,amount,reason) VALUES ('personal-bootstrap-team','legacy-team','personal-bootstrap:team','system','allocation',-amount,'个人钱包上线分配');
  INSERT INTO "PersonalCreditLedger" (id,"userId","sourceTeamId","eventKey","actorId",kind,amount,reason) VALUES ('personal-bootstrap-user',target_user,'legacy-team','personal-bootstrap:user','system','allocation',amount,'原团队分配积分');
 END IF;
END $$;
