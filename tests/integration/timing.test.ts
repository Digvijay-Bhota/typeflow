import { describe, it, expect, vi, beforeEach } from "vitest";
import { submitResult } from "@/server/services/session.service";
import { db } from "@/server/db";

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue({ id: "u1" }),
}));
import { calculateWpm, calculateAccuracy } from "@/features/typing/lib/metrics";

vi.mock("@/server/db", () => ({
  db: {
    testSession: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    testResult: {
      create: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback(db)),
  },
}));

describe("Result Submission Timing & Metric Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getBaseSession = (
    startedAgoMs: number,
    mode: "TIMED" | "WORDS" = "WORDS",
    duration: number | null = null
  ) => ({
    id: "s1",
    integrityToken: "t1",
    userId: "u1",
    trustTier: "FREE",
    status: "ACTIVE",
    startedAt: new Date(Date.now() - startedAgoMs),
    expiresAt: new Date(Date.now() + 100000),
    mode,
    duration,
    passage: { content: "test" },
  });

  const getBaseMetrics = () => ({
    wpm: 0,
    rawWpm: 0,
    accuracy: 0,
    consistency: null,
    correctChars: 250,
    incorrectChars: 50,
    totalChars: 300,
    correctedErrors: 0,
    uncorrectedErrors: 0,
  });

  const getBaseSignals = () => ({
    pasteAttempts: 0,
    copyAttempts: 0,
    focusLossCount: 0,
    visibilityChanges: 0,
    suspiciousPattern: false,
    intervalWpms: [],
    selectionAttempts: 0,
  });

  it("Case A: clientElapsedMs = 60s, serverElapsedMs = 5s -> Uses ~5s", async () => {
    // 5 seconds ago
    (db.testSession.findUnique as any).mockResolvedValue(getBaseSession(5000));
    (db.testSession.updateMany as any).mockResolvedValue({ count: 1 });
    (db.testResult.create as any).mockImplementation(async ({ data }: any) => data);

    const res: any = await submitResult({
      sessionId: "s1",
      integrityToken: "t1",
      clientElapsedMs: 60000,
      metrics: getBaseMetrics(),
      integritySignals: getBaseSignals(),
    });

    // Server time (5s) gives 250 / 5 / (5/60) = 600 WPM, over the 300 cap →
    // INVALID. Client time (60s) would have given 50 WPM and REVIEW, so the
    // INVALID status proves server time was used.
    expect(res.integrityStatus).toBe("INVALID");
    // INVALID results carry no trusted metrics; counts are kept for audit.
    const stored = (db.testResult.create as any).mock.calls[0][0].data;
    expect(res.wpm).toBe(0);
    expect(stored).toMatchObject({ wpm: 0, rawWpm: 0, netWpm: 0, accuracy: 0 });
    expect(stored.correctChars).toBe(250);
  });

  it("Case B: clientElapsedMs = 1s, serverElapsedMs = 60s -> Uses ~60s", async () => {
    // 60 seconds ago
    (db.testSession.findUnique as any).mockResolvedValue(getBaseSession(60000));
    (db.testSession.updateMany as any).mockResolvedValue({ count: 1 });
    (db.testResult.create as any).mockImplementation(async ({ data }: any) => data);

    const res: any = await submitResult({
      sessionId: "s1",
      integrityToken: "t1",
      clientElapsedMs: 1000,
      metrics: getBaseMetrics(),
      integritySignals: getBaseSignals(),
    });

    expect(res.wpm).toBe(50); // 250 chars / 5 = 50 words in 60 seconds = 50 WPM
    expect(res.integrityStatus).toBe("REVIEW");
  });

  it("Case C: client submits fake WPM = 300 -> Server ignores and recalculates", async () => {
    (db.testSession.findUnique as any).mockResolvedValue(getBaseSession(60000));
    (db.testSession.updateMany as any).mockResolvedValue({ count: 1 });
    (db.testResult.create as any).mockImplementation(async ({ data }: any) => data);

    const metrics = getBaseMetrics();
    metrics.wpm = 300; // Faked

    const res: any = await submitResult({
      sessionId: "s1",
      integrityToken: "t1",
      clientElapsedMs: 60000,
      metrics,
      integritySignals: getBaseSignals(),
    });

    // Recalculated should be 50, not 300
    expect(res.wpm).toBe(50);
  });

  it("Case D: client submits fake accuracy = 100% -> Server ignores and recalculates", async () => {
    (db.testSession.findUnique as any).mockResolvedValue(getBaseSession(60000));
    (db.testSession.updateMany as any).mockResolvedValue({ count: 1 });
    (db.testResult.create as any).mockImplementation(async ({ data }: any) => data);

    const metrics = getBaseMetrics();
    metrics.accuracy = 1.0; // Faked 100% despite 50 incorrectChars

    const res: any = await submitResult({
      sessionId: "s1",
      integrityToken: "t1",
      clientElapsedMs: 60000,
      metrics,
      integritySignals: getBaseSignals(),
    });

    // 250 correct / 300 total = 83.3%
    expect(res.accuracy).toBeCloseTo(0.833, 2);
  });

  it("Case E: FREE client submitting forged clientElapsedMs cannot manipulate WPM", async () => {
    // 60 seconds ago on server
    const session = getBaseSession(60000);
    (session as any).trustTier = "FREE";
    (db.testSession.findUnique as any).mockResolvedValue(session);
    (db.testSession.updateMany as any).mockResolvedValue({ count: 1 });
    (db.testResult.create as any).mockImplementation(async ({ data }: any) => data);

    const res: any = await submitResult({
      sessionId: "s1",
      integrityToken: "t1",
      clientElapsedMs: 10000, // 10 seconds claimed by client
      metrics: getBaseMetrics(), // 250 correctChars
      integritySignals: getBaseSignals(),
    });

    // 250 chars / 5 = 50 words.
    // If client time (10s) was used: 50 words / (10/60) min = 300 WPM
    // If server time (60s) was used: 50 words / (60/60) min = 50 WPM

    expect(res.wpm).not.toBe(300); // Proves client manipulation failed
    expect(res.wpm).toBe(50); // Proves authoritative server timing was used
  });
});
