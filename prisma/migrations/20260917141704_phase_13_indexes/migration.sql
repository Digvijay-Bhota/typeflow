/*
  Warnings:

  - Added the required column `updatedAt` to the `test_results` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "test_results" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "test_results_sessionId_idx" ON "test_results"("sessionId");

-- CreateIndex
CREATE INDEX "test_results_userId_idx" ON "test_results"("userId");

-- CreateIndex
CREATE INDEX "test_results_userId_netWpm_accuracy_duration_createdAt_idx" ON "test_results"("userId", "netWpm" DESC, "accuracy" DESC, "duration" ASC, "createdAt" ASC);
