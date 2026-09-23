ALTER TABLE "test_results" ADD COLUMN "traceHash" VARCHAR(64); CREATE UNIQUE INDEX "test_results_traceHash_key" ON "test_results"("traceHash");
