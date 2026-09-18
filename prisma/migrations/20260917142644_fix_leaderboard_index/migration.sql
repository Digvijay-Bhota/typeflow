-- DropIndex
DROP INDEX "test_results_userId_netWpm_accuracy_duration_createdAt_idx";

-- CreateIndex
CREATE INDEX "test_results_integrityStatus_userId_netWpm_accuracy_duratio_idx" ON "test_results"("integrityStatus", "userId", "netWpm" DESC, "accuracy" DESC, "duration" ASC, "createdAt" ASC);
