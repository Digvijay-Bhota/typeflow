import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@/server/db";
import { randomBytes } from "crypto";
import { submitResult } from "@/server/services/session.service";

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
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

describe("FREE-Result Integrity & Trust Model", () => {
  let passageId: string;

  beforeAll(() => {
    process.env.SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.SESSION_SECRET = "secretsecretsecretsecretsecretse";
  });

  beforeAll(async () => {
    const passage = await db.passage.create({
      data: {
        language: "ENGLISH",
        mode: "NORMAL",
        content: "the quick brown fox jumps over the lazy dog",
        wordCount: 9,
        charCount: 43,
        difficulty: "BEGINNER",
        isActive: true,
      },
    });
    passageId = passage.id;
  });

  async function createSession(mode: "TIMED" | "WORDS", duration = 60, startedOffsetMs = 0) {
    const startedAt = new Date(Date.now() - startedOffsetMs);
    const integrityToken = randomBytes(32).toString("hex");
    const session = await db.testSession.create({
      data: {
        mode,
        language: "ENGLISH",
        trustTier: "FREE",
        status: "ACTIVE",
        duration,
        passageId,
        integrityToken,
        startedAt,
        expiresAt: new Date(Date.now() + 300000),
      },
    });
    return { session, integrityToken };
  }

  const baseMetrics = {
    wpm: 120,
    rawWpm: 120,
    accuracy: 1,
    correctChars: 1500,
    incorrectChars: 0,
    totalChars: 1500,
    correctedErrors: 0,
    uncorrectedErrors: 0,
    consistency: 1,
  };

  const baseSignals = {
    pasteAttempts: 0,
    copyAttempts: 0,
    focusLossCount: 0,
    visibilityChanges: 0,
    suspiciousPattern: false,
    intervalWpms: [],
    selectionAttempts: 0,
  };

  it("FREE forged-count test: reconstructs instead of trusting client metrics", async () => {
    // 60-second test started 60 seconds ago
    const { session, integrityToken } = await createSession("TIMED", 60, 60000);
    
    // Trace has 5 characters (index 0 to 4), but client metrics claim 1500 correctChars
    const events: ([number, 0, number, string] | [number, 1, number])[] = [
      [100, 0, 0, "t"],
      [200, 0, 1, "h"],
      [300, 0, 2, "e"],
      [400, 0, 3, " "],
      [500, 0, 4, "q"],
    ];

    const res = await submitResult({
      sessionId: session.id,
      integrityToken,
      metrics: { ...baseMetrics, correctChars: 1500 }, // FORGERY
      integritySignals: baseSignals,
      eventTrace: {
        events,
        totalEvents: 5,
        durationMs: 60000,
      },
    });

    const storedResult = await db.testResult.findUnique({ where: { id: res.resultId } });
    expect(storedResult?.correctChars).toBe(5); // NOT 1500!
    expect(storedResult?.scoringSource).toBe("SERVER_RECONSTRUCTED");
    expect(storedResult?.integrityStatus).toBe("VERIFIED");
  });

  it("Missing evidence test: degrades to REVIEW status and CLIENT_COUNTS", async () => {
    const { session, integrityToken } = await createSession("TIMED", 60, 60000);
    
    const res = await submitResult({
      sessionId: session.id,
      integrityToken,
      metrics: { ...baseMetrics, correctChars: 1500 },
      integritySignals: baseSignals,
      eventTrace: undefined,
    });

    const storedResult = await db.testResult.findUnique({ where: { id: res.resultId } });
    expect(storedResult?.correctChars).toBe(1500);
    expect(storedResult?.scoringSource).toBe("CLIENT_COUNTS");
    expect(storedResult?.integrityStatus).toBe("REVIEW");
  });

  it("Too-early test: TIMED test submitted early with incomplete trace is not verified", async () => {
    // 60s test started only 1 second ago!
    const { session, integrityToken } = await createSession("TIMED", 60, 1000);
    
    const events: ([number, 0, number, string] | [number, 1, number])[] = [
      [100, 0, 0, "t"],
    ];

    const res = await submitResult({
      sessionId: session.id,
      integrityToken,
      metrics: baseMetrics,
      integritySignals: baseSignals,
      eventTrace: { events, totalEvents: 1, durationMs: 1000 },
    });

    const storedResult = await db.testResult.findUnique({ where: { id: res.resultId } });
    expect(storedResult?.integrityStatus).toBe("REVIEW"); // Too early + incomplete
  });

  it("Compressed-time test: trace claims to happen in future", async () => {
    // 60s test, but server thinks only 1 second has elapsed
    const { session, integrityToken } = await createSession("WORDS", 0, 1000);
    
    // Trace timestamp is 15000 (15s), but server elapsed is 1000 (1s)
    const events: ([number, 0, number, string] | [number, 1, number])[] = [
      [15000, 0, 0, "t"],
    ];

    const res = await submitResult({
      sessionId: session.id,
      integrityToken,
      metrics: baseMetrics,
      integritySignals: baseSignals,
      eventTrace: { events, totalEvents: 1, durationMs: 15000 },
    });

    const storedResult = await db.testResult.findUnique({ where: { id: res.resultId } });
    expect(storedResult?.integrityStatus).toBe("REVIEW");
  });

  it("Honest correction test: backspaces and retypes are correctly scored", async () => {
    const { session, integrityToken } = await createSession("WORDS", 0, 10000);
    
    // Type 't', 'x', backspace, 'h' -> correctChars should be 2 ('t', 'h')
    const events: ([number, 0, number, string] | [number, 1, number])[] = [
      [100, 0, 0, "t"],
      [200, 0, 1, "x"],
      [300, 1, 1], // backspace
      [400, 0, 1, "h"],
    ];

    const res = await submitResult({
      sessionId: session.id,
      integrityToken,
      metrics: baseMetrics,
      integritySignals: baseSignals,
      eventTrace: { events, totalEvents: 4, durationMs: 1000 },
    });

    const storedResult = await db.testResult.findUnique({ where: { id: res.resultId } });
    expect(storedResult?.correctChars).toBe(2);
    expect(storedResult?.incorrectChars).toBe(0);
    expect(storedResult?.totalChars).toBe(3); // t, x, h
    expect(storedResult?.correctedErrors).toBe(1);
    expect(storedResult?.uncorrectedErrors).toBe(0);
  });

  it("Leaderboard test: legacy CLIENT_COUNTS FREE rows do not rank", async () => {
    // We already have some results in DB. Let's create specific results.
    const user = await db.user.create({
      data: { authId: crypto.randomUUID(), email: "testlb@example.com" }
    });

    // Valid RECONSTRUCTED
    const { session: s1 } = await createSession("TIMED", 60, 60000);
    await db.testSession.update({ where: { id: s1.id }, data: { status: "COMPLETED", userId: user.id } });
    await db.testResult.create({
      data: {
        sessionId: s1.id, userId: user.id, shareId: "s1", wpm: 200, rawWpm: 200,
        netWpm: 200, accuracy: 1, correctChars: 1000, incorrectChars: 0, totalChars: 1000,
        correctedErrors: 0, uncorrectedErrors: 0, integrityStatus: "VERIFIED", scoringSource: "SERVER_RECONSTRUCTED",
        elapsedMs: 60000, totalKeystrokes: 1000, duration: 60
      }
    });

    // Legacy CLIENT_COUNTS
    const { session: s2 } = await createSession("TIMED", 60, 60000);
    await db.testSession.update({ where: { id: s2.id }, data: { status: "COMPLETED", userId: user.id } });
    await db.testResult.create({
      data: {
        sessionId: s2.id, userId: user.id, shareId: "s2", wpm: 300, rawWpm: 300,
        netWpm: 300, accuracy: 1, correctChars: 1500, incorrectChars: 0, totalChars: 1500,
        correctedErrors: 0, uncorrectedErrors: 0, integrityStatus: "VERIFIED", scoringSource: "CLIENT_COUNTS",
        elapsedMs: 60000, totalKeystrokes: 1500, duration: 60
      }
    });

    const { getLeaderboard } = await import("@/server/services/leaderboard.service");
    const board = await getLeaderboard({ period: "all-time", mode: "timed", limit: 10 });
    
    // It should find the 200 wpm (s1) but NOT the 300 wpm (s2) because s2 is CLIENT_COUNTS
    const userEntries = board.entries.filter(e => e.displayName === "Anonymous Typist" && e.netWpm >= 200); // we use Anonymous Typist since no displayName set
    
    expect(userEntries.length).toBeGreaterThan(0);
    expect(userEntries[0]?.netWpm).toBe(200); // the best valid one is 200
  });
});
