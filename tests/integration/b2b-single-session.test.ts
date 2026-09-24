import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { randomBytes, createHash } from "crypto";
import { createSession } from "@/server/services/session.service";
import {
  addCandidate,
  startCandidateAttempt,
} from "@/server/services/assessment.service";
import { TypingMode, Language } from "@prisma/client";

// Mock the auth service to bypass authenticated user checks for candidates
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
vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, remaining: 10, limit: 10, reset: 0 }),
}));

describe("B2B Single-Session Invariant", () => {
  let owner: any;

  beforeAll(() => {
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.RAZORPAY_KEY_ID = "rzp";
    process.env.RAZORPAY_KEY_SECRET = "rzp";
    process.env.RAZORPAY_WEBHOOK_SECRET = "rzp";
    process.env.SESSION_SECRET = "secretsecretsecretsecretsecretse";
    process.env.CERTIFICATE_SIGNING_SECRET = "certsecretcertsecretcertsecretce";
  });
  let org: any;
  let passage: any;

  beforeAll(async () => {
    const suffix = randomBytes(4).toString("hex");

    owner = await db.user.create({
      data: {
        authId: `10000000-0000-0000-0000-${suffix.padEnd(12, "0")}`,
        email: `owner-${suffix}@test.com`,
      },
    });

    org = await db.organization.create({
      data: { name: `Org ${suffix}`, slug: `org-${suffix}`, ownerId: owner.id },
    });

    passage = await db.passage.create({
      data: {
        language: "ENGLISH",
        mode: "NORMAL",
        content: "Test passage for B2B session.",
        wordCount: 5,
        charCount: 29,
        difficulty: "BEGINNER",
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    // Cleanup if necessary, though vitest global setup might handle it
  });

  // createSession() only ever produces PENDING B2B sessions for a candidate.
  // Other test files write to the same database in parallel, so an unscoped
  // global testSession.count() is racy; scope it to what this file creates.
  function countPendingB2BSessions() {
    return db.testSession.count({
      where: { trustTier: "B2B_ASSESSMENT", status: "PENDING" },
    });
  }

  async function createTestEnvironment(maxAttempts = 1, assessmentStatus = "PUBLISHED") {
    const assessment = await db.assessment.create({
      data: {
        orgId: org.id,
        title: "Security Test Assessment",
        testMode: "TIMED",
        language: "ENGLISH",
        duration: 60,
        maxAttempts,
        status: assessmentStatus as any,
      },
    });

    const email = `candidate-${randomBytes(4).toString("hex")}@test.com`;
    // Manually add candidate to bypass auth checks
    const inviteToken = randomBytes(32).toString("hex");
    const inviteTokenHash = createHash("sha256").update(inviteToken).digest("hex");

    const candidate = await db.assessmentCandidate.create({
      data: {
        assessmentId: assessment.id,
        email,
        name: "Test Candidate",
        inviteTokenHash,
      },
    });

    return { assessment, candidate, inviteToken };
  }

  it("1. Sequential duplicate: rejects creating multiple sessions for same attempt", async () => {
    const { candidate, inviteToken } = await createTestEnvironment(1);

    const attempt = await startCandidateAttempt(inviteToken);

    // Call 1 -> success
    const s1 = await createSession({
      mode: "timed",
      language: "english",
      inviteToken,
      attemptId: attempt.id,
    });
    expect(s1.sessionId).toBeDefined();

    // Call 2 -> DUPLICATE_SESSION
    await expect(
      createSession({
        mode: "timed",
        language: "english",
        inviteToken,
        attemptId: attempt.id,
      })
    ).rejects.toThrow("DUPLICATE_SESSION");

    // Call 3 -> DUPLICATE_SESSION
    await expect(
      createSession({
        mode: "timed",
        language: "english",
        inviteToken,
        attemptId: attempt.id,
      })
    ).rejects.toThrow("DUPLICATE_SESSION");

    const attemptInDb = await db.assessmentAttempt.findUnique({
      where: { id: attempt.id },
    });

    // To check we didn't orphan extra sessions, we know we only created 1 session globally in this block
    expect(attemptInDb?.sessionId).toBe(s1.sessionId);
  });

  it("2. Two-way concurrency: prevents race conditions", async () => {
    const { candidate, inviteToken } = await createTestEnvironment(1);
    const attempt = await startCandidateAttempt(inviteToken);

    const p1 = createSession({
      mode: "timed",
      language: "english",
      inviteToken,
      attemptId: attempt.id,
    });
    const p2 = createSession({
      mode: "timed",
      language: "english",
      inviteToken,
      attemptId: attempt.id,
    });

    const results = await Promise.allSettled([p1, p2]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const rejections = results.filter((r) => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(rejections.length).toBe(1);
    expect((rejections[0] as PromiseRejectedResult).reason.message).toBe(
      "DUPLICATE_SESSION"
    );

    const attemptInDb = await db.assessmentAttempt.findUnique({
      where: { id: attempt.id },
    });
    expect(attemptInDb?.sessionId).toBe(
      (successes[0] as PromiseFulfilledResult<any>).value.sessionId
    );
  });

  it("3. Eight-way concurrency: prevents race conditions at scale", async () => {
    const { candidate, inviteToken } = await createTestEnvironment(1);
    const attempt = await startCandidateAttempt(inviteToken);

    const promises = Array(8)
      .fill(0)
      .map(() =>
        createSession({
          mode: "timed",
          language: "english",
          inviteToken,
          attemptId: attempt.id,
        })
      );

    const results = await Promise.allSettled(promises);

    const successes = results.filter((r) => r.status === "fulfilled");
    const rejections = results.filter((r) => r.status === "rejected");

    expect(successes.length).toBe(1);
    expect(rejections.length).toBe(7);

    for (const rej of rejections) {
      expect((rej as PromiseRejectedResult).reason.message).toBe("DUPLICATE_SESSION");
    }
  });

  it("4. Completed attempt: rejects new sessions", async () => {
    const { candidate, inviteToken } = await createTestEnvironment(1);
    const attempt = await startCandidateAttempt(inviteToken);

    // Artificially complete the attempt
    await db.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    await expect(
      createSession({
        mode: "timed",
        language: "english",
        inviteToken,
        attemptId: attempt.id,
      })
    ).rejects.toThrow("INVALID_ATTEMPT");
  });

  it("5. Legitimate separate attempts: enforces maxAttempts independently", async () => {
    const { candidate, inviteToken } = await createTestEnvironment(2);

    // Attempt 1
    const attempt1 = await startCandidateAttempt(inviteToken);
    const s1 = await createSession({
      mode: "timed",
      language: "english",
      inviteToken,
      attemptId: attempt1.id,
    });
    expect(s1.sessionId).toBeDefined();

    await expect(
      createSession({
        mode: "timed",
        language: "english",
        inviteToken,
        attemptId: attempt1.id,
      })
    ).rejects.toThrow("DUPLICATE_SESSION");

    // Artificially complete attempt1
    await db.assessmentAttempt.update({
      where: { id: attempt1.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    // Attempt 2
    const attempt2 = await startCandidateAttempt(inviteToken);
    const s2 = await createSession({
      mode: "timed",
      language: "english",
      inviteToken,
      attemptId: attempt2.id,
    });
    expect(s2.sessionId).toBeDefined();

    // Attempt 3 (Should fail maxAttempts)
    await db.assessmentAttempt.update({
      where: { id: attempt2.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    await expect(startCandidateAttempt(inviteToken)).rejects.toThrow(
      "MAX_ATTEMPTS_REACHED"
    );
  });

  it("6. Authorization regressions: prevents unauthorized access", async () => {
    const { candidate, inviteToken } = await createTestEnvironment(1);
    const attempt = await startCandidateAttempt(inviteToken);

    // Wrong invite token
    await expect(
      createSession({
        mode: "timed",
        language: "english",
        inviteToken: "wrong",
        attemptId: attempt.id,
      })
    ).rejects.toThrow("INVALID_OR_CLOSED_ASSESSMENT");

    // Invalid attempt ID
    const randomUuid = "00000000-0000-0000-0000-000000000000";
    await expect(
      createSession({
        mode: "timed",
        language: "english",
        inviteToken,
        attemptId: randomUuid,
      })
    ).rejects.toThrow("INVALID_ATTEMPT");
  });

  it("7. Orphan protection: verifies no unreferenced test sessions are created during concurrency", async () => {
    const { candidate, inviteToken } = await createTestEnvironment(1);
    const attempt = await startCandidateAttempt(inviteToken);

    // Count sessions before
    const initialSessions = await countPendingB2BSessions();

    const promises = Array(8)
      .fill(0)
      .map(() =>
        createSession({
          mode: "timed",
          language: "english",
          inviteToken,
          attemptId: attempt.id,
        })
      );

    await Promise.allSettled(promises);

    // Count sessions after
    const finalSessions = await countPendingB2BSessions();

    expect(finalSessions - initialSessions).toBe(1); // Exactly 1 session created globally
  });
  it("8. Route-level 409 test: maps DUPLICATE_SESSION to HTTP 409", async () => {
    const { candidate, inviteToken } = await createTestEnvironment(1);
    const attempt = await startCandidateAttempt(inviteToken);

    // First call succeeds
    const req1 = new Request("http://localhost/api/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "timed",
        language: "english",
        duration: 60,
        inviteToken,
        attemptId: attempt.id,
      }),
    });

    const { POST } = await import("@/app/api/session/create/route");
    const res1 = await POST(req1);
    const json1 = await res1.json();
    if (res1.status !== 201) {
      console.log("RES1 FAILED:", JSON.stringify(json1, null, 2));
    }
    expect(res1.status).toBe(201);

    // Second call fails with 409
    const req2 = new Request("http://localhost/api/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "timed",
        language: "english",
        duration: 60,
        inviteToken,
        attemptId: attempt.id,
      }),
    });

    const res2 = await POST(req2);
    expect(res2.status).toBe(409);

    const json = await res2.json();
    expect(json.error.code).toBe("CONFLICT");
    expect(json.error.message).toBe("A session already exists for this attempt.");
  });

  it("9. Wrong-candidate attempt / IDOR regression", async () => {
    // 1. Create Assessment & Candidate A
    const { assessment, inviteToken: tokenA } = await createTestEnvironment(1);

    // 2. Create Candidate B for the same assessment
    const tokenB = randomBytes(32).toString("hex");
    const tokenBHash = createHash("sha256").update(tokenB).digest("hex");
    const candidateB = await db.assessmentCandidate.create({
      data: {
        assessmentId: assessment.id,
        email: `candidateB-${randomBytes(4).toString("hex")}@test.com`,
        name: "Test Candidate B",
        inviteTokenHash: tokenBHash,
      },
    });

    // 3. Start attempt for A
    const attemptA = await startCandidateAttempt(tokenA);
    const initialSessionCount = await countPendingB2BSessions();

    // 4. Try to create session with B's token and A's attemptId
    await expect(
      createSession({
        mode: "timed",
        language: "english",
        inviteToken: tokenB,
        attemptId: attemptA.id,
      })
    ).rejects.toThrow("INVALID_ATTEMPT");

    // Verify no session was attached or created
    const finalSessionCount = await countPendingB2BSessions();
    expect(finalSessionCount).toBe(initialSessionCount);

    const attemptAInDb = await db.assessmentAttempt.findUnique({
      where: { id: attemptA.id },
    });
    expect(attemptAInDb?.sessionId).toBeNull();
  });

  it("10. Unpublished assessment regression", async () => {
    const { candidate, inviteToken } = await createTestEnvironment(1, "DRAFT");

    // Note: startCandidateAttempt will naturally fail if assessment is not published,
    // but the vulnerability allows passing ANY attemptId + inviteToken directly to createSession.
    // So we manually craft a STARTED attempt.
    const attempt = await db.assessmentAttempt.create({
      data: {
        candidateId: candidate.id,
        attemptNumber: 1,
        status: "STARTED",
      },
    });

    const initialSessionCount = await countPendingB2BSessions();

    await expect(
      createSession({
        mode: "timed",
        language: "english",
        inviteToken,
        attemptId: attempt.id,
      })
    ).rejects.toThrow("INVALID_OR_CLOSED_ASSESSMENT");

    const finalSessionCount = await countPendingB2BSessions();
    expect(finalSessionCount).toBe(initialSessionCount);
  });
});
