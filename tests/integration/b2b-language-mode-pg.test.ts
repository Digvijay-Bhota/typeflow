import { describe, it, expect, beforeAll, vi } from "vitest";
import { db } from "@/server/db";
import { randomBytes, createHash } from "crypto";
import { POST } from "@/app/api/org/[orgId]/assessments/route";
import { createSession } from "@/server/services/session.service";
import { startCandidateAttempt } from "@/server/services/assessment.service";

// Mock rate limit
vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, remaining: 10, limit: 10, reset: 0 }),
}));
// Mock organization role requirement
vi.mock("@/server/services/organization.service", () => ({
  requireOrganizationRole: vi.fn().mockResolvedValue({}),
}));
// Mock auth
vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockReturnValue({
    get: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    setAll: vi.fn(),
  }),
}));

describe("B2B Language and Mode Integrity", () => {
  let org: any;

  beforeAll(async () => {
    const suffix = randomBytes(4).toString("hex");
    const owner = await db.user.create({
      data: {
        authId: `00000000-0000-0000-0000-${suffix.padEnd(12, "0")}`,
        email: `owner-${suffix}@test.com`,
      },
    });
    org = await db.organization.create({
      data: { name: `Org ${suffix}`, slug: `org-${suffix}`, ownerId: owner.id },
    });
  });

  it("Case A: Unsupported language (SPANISH) is rejected by validation", async () => {
    const req = new Request("http://localhost/api/org/123/assessments", {
      method: "POST",
      body: JSON.stringify({
        title: "Test",
        testMode: "TIMED",
        language: "SPANISH",
        duration: 60,
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ orgId: org.id }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
    // Verify it complains about language validation, not a Prisma 500 leak
    expect(typeof json.error).toBe("string");
    expect(json.error).toContain("Invalid enum value"); // Zod error includes this
  });

  it("Case B: Valid CODE assessment -> correct language/mode combination -> session uses CODE behavior", async () => {
    // Manually create the assessment since we bypass API in this step
    const assessment = await db.assessment.create({
      data: {
        orgId: org.id,
        title: "Code Test",
        testMode: "CODE",
        language: "CODE",
        codeLanguage: "JAVASCRIPT",
        duration: 120,
        maxAttempts: 1,
        status: "PUBLISHED",
      },
    });

    const token = randomBytes(32).toString("hex");
    const candidate = await db.assessmentCandidate.create({
      data: {
        assessmentId: assessment.id,
        email: `code_${Date.now()}@test.com`,
        inviteTokenHash: createHash("sha256").update(token).digest("hex"),
        status: "INVITED",
      },
    });

    const attempt = await startCandidateAttempt(token);
    const session = await createSession({
      inviteToken: token,
      attemptId: attempt.id,
    } as any);

    expect(session.mode).toBe("code");
    expect(session.language).toBe("code");
    expect(session.codeLanguage).toBe("javascript");
  });

  it("Case C: WORDS assessment -> remains WORDS -> does not become TIMED", async () => {
    const assessment = await db.assessment.create({
      data: {
        orgId: org.id,
        title: "Words Test",
        testMode: "WORDS",
        language: "ENGLISH",
        duration: 60, // Still required by schema even if words
        maxAttempts: 1,
        status: "PUBLISHED",
      },
    });

    const token = randomBytes(32).toString("hex");
    const candidate = await db.assessmentCandidate.create({
      data: {
        assessmentId: assessment.id,
        email: `words_${Date.now()}@test.com`,
        inviteTokenHash: createHash("sha256").update(token).digest("hex"),
        status: "INVITED",
      },
    });

    const attempt = await startCandidateAttempt(token);
    const session = await createSession({
      inviteToken: token,
      attemptId: attempt.id,
    } as any);

    expect(session.mode).toBe("words");
    expect(session.language).toBe("english");
  });

  it("Case D: Existing valid ENGLISH timed assessment -> still succeeds", async () => {
    const assessment = await db.assessment.create({
      data: {
        orgId: org.id,
        title: "Timed Test",
        testMode: "TIMED",
        language: "ENGLISH",
        duration: 60,
        maxAttempts: 1,
        status: "PUBLISHED",
      },
    });

    const token = randomBytes(32).toString("hex");
    const candidate = await db.assessmentCandidate.create({
      data: {
        assessmentId: assessment.id,
        email: `timed_${Date.now()}@test.com`,
        inviteTokenHash: createHash("sha256").update(token).digest("hex"),
        status: "INVITED",
      },
    });

    const attempt = await startCandidateAttempt(token);
    const session = await createSession({
      inviteToken: token,
      attemptId: attempt.id,
    } as any);

    expect(session.mode).toBe("timed");
    expect(session.language).toBe("english");
    expect(session.duration).toBe(60);
  });

  it("Next 2: candidate session creation independently re-checks invitation expiry", async () => {
    const assessment = await db.assessment.create({
      data: {
        orgId: org.id,
        title: "Expiry Test",
        testMode: "TIMED",
        language: "ENGLISH",
        duration: 60,
        maxAttempts: 1,
        status: "PUBLISHED",
      },
    });

    const token = randomBytes(32).toString("hex");
    const candidate = await db.assessmentCandidate.create({
      data: {
        assessmentId: assessment.id,
        email: `expiry_${Date.now()}@test.com`,
        inviteTokenHash: createHash("sha256").update(token).digest("hex"),
        status: "INVITED",
      },
    });

    // Start attempt while valid
    const attempt = await startCandidateAttempt(token);

    // Manually expire candidate in DB to simulate time passing between API calls
    await db.assessmentCandidate.update({
      where: { id: candidate.id },
      data: { expiresAt: new Date(Date.now() - 10000) },
    });

    // createSession should now fail
    await expect(
      createSession({ inviteToken: token, attemptId: attempt.id } as any)
    ).rejects.toThrow("INVITATION_EXPIRED");
  });
});
