ALTER TABLE "User" ADD COLUMN "avatarKey" TEXT;
CREATE TABLE "Feedback" (
  "id" TEXT PRIMARY KEY,
  "teamId" TEXT NOT NULL REFERENCES "Team"("id"),
  "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "type" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "attachments" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Feedback_teamId_createdAt_idx" ON "Feedback"("teamId", "createdAt");
CREATE INDEX "Feedback_userId_createdAt_idx" ON "Feedback"("userId", "createdAt");
