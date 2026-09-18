import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "crypto";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:password@localhost:5434/testing"
    }
  }
});

async function main() {
  const userId = "00000000-0000-0000-0000-000000000001";
  const orgId = "00000000-0000-0000-0000-000000000002";
  const assessmentId = "00000000-0000-0000-0000-000000000003";
  const candidateId = "00000000-0000-0000-0000-000000000004";
  const inviteToken = "my-secret-token-123";

  // Create user
  await prisma.$executeRawUnsafe(`INSERT INTO users (id, "authId", email, "updatedAt") VALUES ('${userId}', '11111111-1111-1111-1111-111111111111', 'test@test.com', now())`);
  
  // Create organization
  await prisma.$executeRawUnsafe(`INSERT INTO organizations (id, name, slug, "ownerId", "updatedAt") VALUES ('${orgId}', 'Test Org', 'test-org', '${userId}', now())`);

  // Create assessment
  await prisma.$executeRawUnsafe(`INSERT INTO assessments (id, "orgId", title, "testMode", language, duration, "maxAttempts", status, "updatedAt") VALUES ('${assessmentId}', '${orgId}', 'Test Assessment', 'TIMED', 'ENGLISH', 60, 1, 'PUBLISHED', now())`);

  // Create candidate WITH OLD SCHEMA
  await prisma.$executeRawUnsafe(`INSERT INTO assessment_candidates (id, "assessmentId", email, "inviteToken", "updatedAt") VALUES ('${candidateId}', '${assessmentId}', 'candidate@test.com', '${inviteToken}', now())`);

  console.log("Seeded pre-migration data successfully");
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
