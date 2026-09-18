-- AlterTable
ALTER TABLE "assessment_attempts" ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1;

-- Install pgcrypto if not exists to safely hash in the DB without exporting
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add new column
ALTER TABLE "assessment_candidates" ADD COLUMN "inviteTokenHash" VARCHAR(128);

-- Migrate existing tokens securely (SHA-256 encoded as hex)
UPDATE "assessment_candidates" SET "inviteTokenHash" = encode(digest("inviteToken", 'sha256'), 'hex');

-- Ensure all are migrated, then drop old column and enforce NOT NULL
ALTER TABLE "assessment_candidates" ALTER COLUMN "inviteTokenHash" SET NOT NULL;
ALTER TABLE "assessment_candidates" DROP COLUMN "inviteToken";

-- CreateIndex
CREATE UNIQUE INDEX "assessment_attempts_candidateId_attemptNumber_key" ON "assessment_attempts"("candidateId", "attemptNumber");
CREATE UNIQUE INDEX "assessment_candidates_inviteTokenHash_key" ON "assessment_candidates"("inviteTokenHash");
CREATE INDEX "assessment_candidates_inviteTokenHash_idx" ON "assessment_candidates"("inviteTokenHash");
