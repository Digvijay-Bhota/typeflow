import { describe, it, expect, vi, beforeEach } from "vitest";
import { getResultByShareId } from "@/server/services/result.service";
import { checkCertificateEligibility } from "@/server/services/certificate.service";
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
    scoringSource: "SERVER_RECONSTRUCTED",
    userId: "user-1",
    createdAt: new Date("2026-09-16T12:00:00Z"),
    errorMap: { e: { expected: "e", count: 12, corrected: 6, uncorrected: 6 } },
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
    expect(res?.errorMap).toEqual({
      e: { expected: "e", count: 12, corrected: 6, uncorrected: 6 },
    });
    expect(res?.isCertificateEligible).toBe(false); // FREE tier
  });

  it("handles missing errorMap gracefully (null)", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(
      getMockDbResult({ errorMap: null })
    );
    const res = await getResultByShareId("share1");
    expect(res?.errorMap).toBeNull();
  });

  it("handles zero-error result gracefully", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(
      getMockDbResult({
        accuracy: 1,
        incorrectChars: 0,
        correctedErrors: 0,
        uncorrectedErrors: 0,
        errorMap: {},
      })
    );
    const res = await getResultByShareId("share1");
    expect(res?.accuracy).toBe(1);
    expect(res?.incorrectChars).toBe(0);
    expect(res?.errorMap).toEqual({});
  });

  it("handles low-accuracy result correctly", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(
      getMockDbResult({
        accuracy: 0.15,
        incorrectChars: 200,
      })
    );
    const res = await getResultByShareId("share1");
    expect(res?.accuracy).toBe(0.15);
    expect(res?.incorrectChars).toBe(200);
  });

  const certSession = {
    mode: "TIMED",
    language: "ENGLISH",
    trustTier: "CERTIFICATE",
    duration: 300,
    passage: { content: "test" },
  };

  it.each([
    ["CERTIFICATE + VERIFIED + SERVER_RECONSTRUCTED meeting thresholds", {}, true],
    ["CLIENT_COUNTS", { scoringSource: "CLIENT_COUNTS" }, false],
    ["REVIEW", { integrityStatus: "REVIEW" }, false],
    ["INVALID", { integrityStatus: "INVALID" }, false],
    ["guest (no user)", { userId: null }, false],
    ["below minimum duration", { session: { ...certSession, duration: 60 } }, false],
    ["FREE tier", { session: { ...certSession, trustTier: "FREE" } }, false],
  ])(
    "isCertificateEligible matches actual issuance eligibility: %s",
    async (_label, overrides, expected) => {
      const row = getMockDbResult({ session: certSession, ...overrides });
      (db.testResult.findUnique as any).mockResolvedValue(row);

      const res = await getResultByShareId("share1");
      const issuance = await checkCertificateEligibility("uuid1");

      expect(res?.isCertificateEligible).toBe(expected);
      // The public flag can never drift from what issuance allows.
      expect(res?.isCertificateEligible).toBe(issuance.eligible);
    }
  );

  it("exposes scoringSource and never the internal result id", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(
      getMockDbResult({ scoringSource: "CLIENT_COUNTS" })
    );
    const res = await getResultByShareId("share1");
    expect(res?.scoringSource).toBe("CLIENT_COUNTS");
    expect(res).not.toHaveProperty("resultId");
    expect(res).not.toHaveProperty("id");
    expect(JSON.stringify(res)).not.toContain("uuid1");
  });

  it("does not reveal claimToken, eventTrace, or userId in public result", async () => {
    (db.testResult.findUnique as any).mockResolvedValue(
      getMockDbResult({
        userId: "user-1",
        claimToken: "secret123",
        eventTrace: [{ k: "a", t: 100 }],
        traceHash: "a".repeat(64),
        integrityToken: "token-secret",
        sessionId: "session-uuid",
        user: { displayName: null, email: "person@example.com" },
      })
    );
    const res = await getResultByShareId("share1");
    for (const key of [
      "claimToken",
      "eventTrace",
      "userId",
      "traceHash",
      "integrityToken",
      "sessionId",
      "integritySignals",
      "email",
    ]) {
      expect(res).not.toHaveProperty(key);
    }
    const serialized = JSON.stringify(res);
    for (const secret of [
      "secret123",
      "token-secret",
      "a".repeat(64),
      "person@example.com",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
