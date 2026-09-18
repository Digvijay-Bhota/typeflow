import { describe, it, expect, vi, beforeEach } from "vitest";
import { getResultByShareId } from "@/server/services/result.service";
import { db } from "@/server/db";

vi.mock("@/server/db", () => ({
  db: {
    testResult: {
      findUnique: vi.fn(),
    },
  },
}));

describe("Result Transformation & Mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getMockDbResult = (overrides = {}) => ({
    id: "uuid1",
    shareId: "share1",
    wpm: 78.4,
    rawWpm: 80,
    netWpm: 75,
    accuracy: 0.964,
    consistency: 0.912,
    correctChars: 300,
    incorrectChars: 10,
    totalChars: 310,
    correctedErrors: 5,
    uncorrectedErrors: 5,
    elapsedMs: 60000,
    duration: 60,
    integrityStatus: "VERIFIED",
    createdAt: new Date("2026-09-16T12:00:00Z"),
    errorMap: { "e": { expected: "e", count: 12, corrected: 6, uncorrected: 6 } },
    session: {
      mode: "TIMED",
      language: "ENGLISH",
      trustTier: "FREE",
      passage: { content: "test" },
    },
    ...overrides,
  });

  it("returns null when result not found", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(null);
    const res = await getResultByShareId("missing");
    expect(res).toBeNull();
  });

  it("maps valid result correctly to public view", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(getMockDbResult());
    const res = await getResultByShareId("share1");
    expect(res).not.toBeNull();
    expect(res?.shareUrl).toBe("/result/share1");
    expect(res?.mode).toBe("TIMED");
    expect(res?.language).toBe("ENGLISH");
    expect(res?.errorMap).toEqual({ "e": { expected: "e", count: 12, corrected: 6, uncorrected: 6 } });
    expect(res?.isCertificateEligible).toBe(false); // FREE tier
  });

  it("handles missing errorMap gracefully (null)", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(getMockDbResult({ errorMap: null }));
    const res = await getResultByShareId("share1");
    expect(res?.errorMap).toBeNull();
  });

  it("handles zero-error result gracefully", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(getMockDbResult({
      accuracy: 1,
      incorrectChars: 0,
      correctedErrors: 0,
      uncorrectedErrors: 0,
      errorMap: {}
    }));
    const res = await getResultByShareId("share1");
    expect(res?.accuracy).toBe(1);
    expect(res?.incorrectChars).toBe(0);
    expect(res?.errorMap).toEqual({});
  });

  it("handles low-accuracy result correctly", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(getMockDbResult({
      accuracy: 0.15,
      incorrectChars: 200,
    }));
    const res = await getResultByShareId("share1");
    expect(res?.accuracy).toBe(0.15);
    expect(res?.incorrectChars).toBe(200);
  });

  it("sets isCertificateEligible true for CERTIFICATE tier with VERIFIED status", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(getMockDbResult({
      integrityStatus: "VERIFIED",
      session: {
        mode: "CERTIFICATE",
        language: "ENGLISH",
        trustTier: "CERTIFICATE",
        passage: { content: "test" },
      }
    }));
    const res = await getResultByShareId("share1");
    expect(res?.isCertificateEligible).toBe(true);
  });

  it("does not reveal claimToken, eventTrace, or userId in public result", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(getMockDbResult({
      userId: "user-1",
      claimToken: "secret123",
      eventTrace: [{ k: "a", t: 100 }],
    }));
    const res = await getResultByShareId("share1");
    expect(res).not.toHaveProperty("claimToken");
    expect(res).not.toHaveProperty("eventTrace");
    expect(res).not.toHaveProperty("userId");
  });
});
