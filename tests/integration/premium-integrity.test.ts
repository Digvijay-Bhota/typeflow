import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/server/db";
import { submitResult, startSession } from "@/server/services/session.service";
import { checkCertificateEligibility } from "@/server/services/certificate.service";
import { randomBytes, randomUUID } from "crypto";
import { vi } from "vitest";

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

describe("Premium Integrity & B2B Scenarios", () => {
  let user: any;
  let passage: any;

  beforeEach(async () => {
    user = await db.user.create({
      data: {
        id: randomUUID(),
        email: "test" + Date.now() + "@x.com",
        authId: randomUUID(),
      },
    });

    passage = await db.passage.create({
      data: {
        content: "test passage for this test",
        sourceAttribution: "test",
        wordCount: 5,
        charCount: 26,
      },
    });
  });

  const createTrace = (str: string, durationMs: number = 2000): any[] => {
    const events: any[] = [];
    const interval = durationMs / str.length;
    for (let i = 0; i < str.length; i++) {
      events.push([Math.floor(i * interval), 0, i, str[i]]);
    }
    return events;
  };

  it("prevents backspace metric inflation", async () => {
    const session = await db.testSession.create({
      data: {
        userId: null,
        mode: "WORDS",
        language: "ENGLISH",
        trustTier: "CERTIFICATE",
        status: "ACTIVE",
        passageId: passage.id,
        integrityToken: "token-1",
        startedAt: new Date(Date.now() - 5000), // 5 seconds ago
        expiresAt: new Date(Date.now() + 60000),
      },
    });

    const expected = passage.content[0];
    const events: any[] = [];
    // Inflate heavily
    for (let i = 0; i < 500; i++) {
      events.push([i * 10, 0, 0, expected]);
      events.push([i * 10 + 5, 1, 0]);
    }
    events.push([5000, 0, 0, expected]); // finally type it

    const result = await submitResult({
      sessionId: session.id,
      integrityToken: "token-1",
      metrics: {
        correctChars: 501,
        incorrectChars: 0,
        totalChars: 501,
        correctedErrors: 0,
        uncorrectedErrors: 0,
      } as any,
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [],
        selectionAttempts: 0,
      },
      eventTrace: { events, totalEvents: 1001, durationMs: 5000 },
    });

    const dbResult = await db.testResult.findUnique({ where: { id: result.resultId } });
    expect(dbResult?.correctChars).toBe(1); // Real correct chars
    expect(dbResult?.integrityStatus).toBe("VERIFIED");
  });

  it("prevents time compression in TIMED mode (Early Submission)", async () => {
    const session = await db.testSession.create({
      data: {
        userId: null,
        mode: "TIMED",
        language: "ENGLISH",
        duration: 60,
        trustTier: "CERTIFICATE",
        status: "ACTIVE",
        passageId: passage.id,
        integrityToken: "token-early",
        startedAt: new Date(Date.now() - 2000), // Only 2 seconds elapsed
        expiresAt: new Date(Date.now() + 60000),
      },
    });

    // Trace spans 60 seconds
    const trace = createTrace(passage.content.substring(0, 50), 60000);

    const result = await submitResult({
      sessionId: session.id,
      integrityToken: "token-early",
      metrics: {
        correctChars: 50,
        incorrectChars: 0,
        totalChars: 50,
        correctedErrors: 0,
        uncorrectedErrors: 0,
      } as any,
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [],
        selectionAttempts: 0,
      },
      eventTrace: { events: trace, totalEvents: 50, durationMs: 60000 },
    });

    expect(result.integrityStatus).toBe("INVALID");
  });

  it("prevents future timestamp", async () => {
    const session = await db.testSession.create({
      data: {
        userId: null,
        mode: "WORDS",
        language: "ENGLISH",
        trustTier: "CERTIFICATE",
        status: "ACTIVE",
        passageId: passage.id,
        integrityToken: "token-future",
        startedAt: new Date(Date.now() - 5000), // 5 seconds
        expiresAt: new Date(Date.now() + 60000),
      },
    });

    const trace = createTrace(passage.content.substring(0, 10), 10000); // Trace has events up to 10s

    const result = await submitResult({
      sessionId: session.id,
      integrityToken: "token-future",
      metrics: {
        correctChars: 10,
        incorrectChars: 0,
        totalChars: 10,
        correctedErrors: 0,
        uncorrectedErrors: 0,
      } as any,
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [],
        selectionAttempts: 0,
      },
      eventTrace: { events: trace, totalEvents: 10, durationMs: 10000 },
    });

    expect(result.integrityStatus).toBe("INVALID");
  });

  it("prevents unhandled 500s on concurrent exact trace replay", async () => {
    const passage = await db.passage.create({
      data: {
        content: "concurrent passage content",
        sourceAttribution: "concurrent",
        difficulty: "BEGINNER",
        wordCount: 3,
        charCount: 26,
      },
    });
    const session1 = await db.testSession.create({
      data: {
        mode: "TIMED",
        language: "ENGLISH",
        trustTier: "CERTIFICATE",
        status: "ACTIVE",
        passageId: passage.id,
        integrityToken: "b2b-token-c",
        duration: 60,
        startedAt: new Date(Date.now() - 60000),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const session2 = await db.testSession.create({
      data: {
        mode: "TIMED",
        language: "ENGLISH",
        trustTier: "CERTIFICATE",
        status: "ACTIVE",
        passageId: passage.id,
        integrityToken: "b2b-token-d",
        duration: 60,
        startedAt: new Date(Date.now() - 60000),
        expiresAt: new Date(Date.now() + 60000),
      },
    });

    const trace = createTrace(passage.content.substring(0, 15), 60000);
    const result1Promise = submitResult({
      sessionId: session1.id,
      integrityToken: "b2b-token-c",
      metrics: {
        correctChars: 15,
        incorrectChars: 0,
        totalChars: 15,
        correctedErrors: 0,
        uncorrectedErrors: 0,
      } as any,
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [],
        selectionAttempts: 0,
      },
      eventTrace: { events: trace, totalEvents: 15, durationMs: 60000 },
    });

    const result2Promise = submitResult({
      sessionId: session2.id,
      integrityToken: "b2b-token-d",
      metrics: {
        correctChars: 15,
        incorrectChars: 0,
        totalChars: 15,
        correctedErrors: 0,
        uncorrectedErrors: 0,
      } as any,
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [],
        selectionAttempts: 0,
      },
      eventTrace: { events: trace, totalEvents: 15, durationMs: 60000 },
    });

    const results = await Promise.allSettled([result1Promise, result2Promise]);

    // Both should settle without throwing unhandled 500s.
    if (results[0].status === "rejected") console.error("R0:", results[0].reason);
    if (results[1].status === "rejected") console.error("R1:", results[1].reason);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("fulfilled");

    const fulfilledResults = results.map((r) => (r as PromiseFulfilledResult<any>).value);

    // One should be VERIFIED, the other INVALID (or both INVALID if they perfectly race, but the point is no 500)
    const statuses = fulfilledResults.map((r) => r.integrityStatus);
    expect(statuses).toContain("VERIFIED");
    expect(statuses).toContain("INVALID");
  });

  it("prevents cross-session exact replay", async () => {
    const trace = createTrace(passage.content.substring(0, 13), 6001);

    const sessionA = await db.testSession.create({
      data: {
        userId: null,
        mode: "WORDS",
        language: "ENGLISH",
        trustTier: "CERTIFICATE",
        status: "ACTIVE",
        passageId: passage.id,
        integrityToken: "token-a",
        startedAt: new Date(Date.now() - 6000),
        expiresAt: new Date(Date.now() + 60000),
      },
    });

    await submitResult({
      sessionId: sessionA.id,
      integrityToken: "token-a",
      metrics: {
        correctChars: 10,
        incorrectChars: 0,
        totalChars: 10,
        correctedErrors: 0,
        uncorrectedErrors: 0,
      } as any,
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [],
        selectionAttempts: 0,
      },
      eventTrace: { events: trace, totalEvents: 10, durationMs: 5000 },
    });

    const sessionB = await db.testSession.create({
      data: {
        userId: null,
        mode: "WORDS",
        language: "ENGLISH",
        trustTier: "CERTIFICATE",
        status: "ACTIVE",
        passageId: passage.id,
        integrityToken: "token-b",
        startedAt: new Date(Date.now() - 6000),
        expiresAt: new Date(Date.now() + 60000),
      },
    });

    const resultB = await submitResult({
      sessionId: sessionB.id,
      integrityToken: "token-b",
      metrics: {
        correctChars: 10,
        incorrectChars: 0,
        totalChars: 10,
        correctedErrors: 0,
        uncorrectedErrors: 0,
      } as any,
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [],
        selectionAttempts: 0,
      },
      eventTrace: { events: trace, totalEvents: 10, durationMs: 5000 }, // EXACT SAME TRACE
    });

    expect(resultB.integrityStatus).toBe("INVALID"); // Rejected due to hash match
  });

  it("verifies honest timed result properly", async () => {
    const session = await db.testSession.create({
      data: {
        userId: null,
        mode: "TIMED",
        duration: 15,
        language: "ENGLISH",
        trustTier: "CERTIFICATE",
        status: "ACTIVE",
        passageId: passage.id,
        integrityToken: "token-honest",
        startedAt: new Date(Date.now() - 16000),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const trace = createTrace(passage.content.substring(0, 20), 15000);
    const result = await submitResult({
      sessionId: session.id,
      integrityToken: "token-honest",
      metrics: {
        correctChars: 20,
        incorrectChars: 0,
        totalChars: 20,
        correctedErrors: 0,
        uncorrectedErrors: 0,
      } as any,
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [],
        selectionAttempts: 0,
      },
      eventTrace: { events: trace, totalEvents: 20, durationMs: 15000 },
    });
    expect(result.integrityStatus).toBe("VERIFIED");
  });

  it("handles B2B Assessment chain correctly", async () => {
    const org = await db.organization.create({
      data: { name: "Test Org", slug: "test-org", ownerId: user.id },
    });
    const assessment = await db.assessment.create({
      data: {
        orgId: org.id,
        title: "Test Assessment",
        testMode: "WORDS",
        language: "ENGLISH",
        duration: 60,
        status: "PUBLISHED",
      },
    });
    const candidate = await db.assessmentCandidate.create({
      data: {
        assessmentId: assessment.id,
        email: "test@example.com",
        inviteTokenHash: "hash",
      },
    });

    const session = await db.testSession.create({
      data: {
        mode: "WORDS",
        language: "ENGLISH",
        trustTier: "B2B_ASSESSMENT",
        status: "ACTIVE",
        passageId: passage.id,
        integrityToken: "b2b-token",
        startedAt: new Date(Date.now() - 6000),
        expiresAt: new Date(Date.now() + 60000),
      },
    });

    const attempt = await db.assessmentAttempt.create({
      data: { candidateId: candidate.id, sessionId: session.id, status: "STARTED" },
    });

    // Valid submission
    const trace = createTrace(passage.content.substring(0, 12), 6000);
    const result = await submitResult({
      sessionId: session.id,
      integrityToken: "b2b-token",
      metrics: {
        correctChars: 10,
        incorrectChars: 0,
        totalChars: 10,
        correctedErrors: 0,
        uncorrectedErrors: 0,
      } as any,
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [],
        selectionAttempts: 0,
      },
      eventTrace: { events: trace, totalEvents: 10, durationMs: 5000 },
    });

    expect(result.integrityStatus).toBe("VERIFIED");
    const updatedAttempt = await db.assessmentAttempt.findUnique({
      where: { id: attempt.id },
    });
    expect(updatedAttempt?.status).toBe("COMPLETED");
  });

  it("marks B2B Attempt FAILED on INVALID trace", async () => {
    const org = await db.organization.create({
      data: { name: "Test Org 2", slug: "test-org-2", ownerId: user.id },
    });
    const assessment = await db.assessment.create({
      data: {
        orgId: org.id,
        title: "Test Assessment 2",
        testMode: "WORDS",
        language: "ENGLISH",
        duration: 60,
        status: "PUBLISHED",
      },
    });
    const candidate = await db.assessmentCandidate.create({
      data: {
        assessmentId: assessment.id,
        email: "test2@example.com",
        inviteTokenHash: "hash2",
      },
    });

    const session = await db.testSession.create({
      data: {
        mode: "WORDS",
        language: "ENGLISH",
        trustTier: "B2B_ASSESSMENT",
        status: "ACTIVE",
        passageId: passage.id,
        integrityToken: "b2b-token-fail",
        startedAt: new Date(Date.now() - 6000),
        expiresAt: new Date(Date.now() + 60000),
      },
    });

    const attempt = await db.assessmentAttempt.create({
      data: { candidateId: candidate.id, sessionId: session.id, status: "STARTED" },
    });

    // Invalid submission (empty trace)
    await submitResult({
      sessionId: session.id,
      integrityToken: "b2b-token-fail",
      metrics: {
        correctChars: 10,
        incorrectChars: 0,
        totalChars: 10,
        correctedErrors: 0,
        uncorrectedErrors: 0,
      } as any,
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [],
        selectionAttempts: 0,
      },
      eventTrace: { events: [], totalEvents: 0, durationMs: 0 },
    });

    const updatedAttempt = await db.assessmentAttempt.findUnique({
      where: { id: attempt.id },
    });
    expect(updatedAttempt?.status).toBe("INVALIDATED"); // Expected from logic
  });
});
