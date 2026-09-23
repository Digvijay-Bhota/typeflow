-- CreateEnum
CREATE TYPE "ScoringSource" AS ENUM ('CLIENT_COUNTS', 'SERVER_RECONSTRUCTED');

-- AlterTable
ALTER TABLE "test_results" ADD COLUMN     "scoringSource" "ScoringSource" NOT NULL DEFAULT 'CLIENT_COUNTS';
