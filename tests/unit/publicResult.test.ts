import { describe, it, expect } from "vitest";
import { getPublicResult } from "@/features/analytics/lib/publicResult";

describe("publicResult helper", () => {
  it("removes sensitive fields and correctly derives intervalWpms and weakKeys", () => {
    const rawResult: any = {
      id: "result-1",
      shareId: "share-123",
      wpm: 120,
      rawWpm: 125,
      netWpm: 120,
      accuracy: 98.5,
      consistency: 0.95,
      correctChars: 600,
      incorrectChars: 5,
      totalChars: 605,
      totalKeystrokes: 602,
      correctedErrors: 2,
      uncorrectedErrors: 3,
      integrityStatus: "VERIFIED",
      scoringSource: "CLIENT_SUBMITTED",
      createdAt: new Date(),
      session: {
        mode: "FREE",
        language: "ENGLISH",
        codeLanguage: null,
        trustTier: "FREE",
        duration: 60,
        passage: {
          sourceAttribution: "public-source",
          privateField: "secret",
        },
        user: {
          id: "private-user",
        },
        internalToken: "secret",
      },
      claimToken: "secret-token",
      userId: "user-1",
      eventTrace: { events: [] },
      integritySignals: {
        intervalWpms: [100, 110, "bad", -5, 120],
      },
      errorMap: {
        a: { count: 10 },
        b: { count: 5 },
        c: { count: 15 },
        d: { count: -1 }, // Should be ignored
        e: { count: "not-a-number" }, // Should be ignored
        f: { count: 1 },
        g: { count: 2 },
        h: { count: 3 },
        i: { count: 4 },
        j: { count: 6 },
        k: { count: 7 }, // We have 11 total entries, 2 invalid, 9 valid, limit is 8
      },
      codeMetrics: { complexity: 10 },
    };

    const publicPayload = getPublicResult(rawResult) as any;

    // Assert sensitive fields are absent
    expect(publicPayload).not.toHaveProperty("claimToken");
    expect(publicPayload).not.toHaveProperty("userId");
    expect(publicPayload).not.toHaveProperty("eventTrace");
    expect(publicPayload).not.toHaveProperty("integritySignals");
    expect(publicPayload).not.toHaveProperty("errorMap");
    expect(publicPayload).not.toHaveProperty("codeMetrics");

    // Assert intervalWpms is sanitized
    expect(publicPayload.intervalWpms).toEqual([100, 110, 120]);

    // Assert weakKeys is sanitized, sorted, limited
    expect(publicPayload.weakKeys).toEqual([
      { key: "c", count: 15 },
      { key: "a", count: 10 },
      { key: "k", count: 7 },
      { key: "j", count: 6 },
      { key: "b", count: 5 },
      { key: "i", count: 4 },
      { key: "h", count: 3 },
      { key: "g", count: 2 },
    ]);
    expect(publicPayload.weakKeys.length).toBe(8);

    // The internal id is omitted unless the viewer owns the result
    expect(publicPayload).not.toHaveProperty("id");
    expect((getPublicResult(rawResult, { includeId: true }) as any).id).toBe("result-1");

    // Assert basic properties remain intact
    expect(publicPayload.wpm).toBe(120);
    expect(publicPayload.totalKeystrokes).toBe(602);

    // Assert session fields
    expect(publicPayload.session.mode).toBe("FREE");
    expect(publicPayload.session.language).toBe("ENGLISH");
    expect(publicPayload.session.trustTier).toBe("FREE");
    expect(publicPayload.session.duration).toBe(60);
    expect(publicPayload.session.passage?.sourceAttribution).toBe("public-source");

    // Assert private session fields are absent
    expect(publicPayload.session).not.toHaveProperty("user");
    expect(publicPayload.session).not.toHaveProperty("internalToken");
    expect(publicPayload.session?.passage).not.toHaveProperty("privateField");
  });

  it("derives intervalWpms from the trace for SERVER_RECONSTRUCTED results, ignoring client samples", () => {
    const passage = "abcdefghij".repeat(10);
    // One correct char every 200 ms for 12 s → 60 chars.
    const events = Array.from({ length: 60 }, (_, i) => [
      (i + 1) * 200,
      0,
      i,
      passage[i],
    ]);
    const payload = getPublicResult({
      id: "r1",
      shareId: "s1",
      netWpm: 60,
      accuracy: 1,
      integrityStatus: "VERIFIED",
      scoringSource: "SERVER_RECONSTRUCTED",
      eventTrace: { events, totalEvents: 60, durationMs: 12_000 },
      integritySignals: { intervalWpms: [999, 999, 999] },
      session: { trustTier: "FREE", duration: 15, passage: { content: passage } },
    }) as any;

    // At 5 s: 24 correct chars → 57.6 WPM; at 10 s: 49 → 58.8 WPM.
    expect(payload.intervalWpms).toEqual([57.6, 58.8]);
    expect(payload.session.passage).not.toHaveProperty("content");
  });

  it("uses the shared certificate eligibility rule", () => {
    const base = {
      shareId: "s1",
      netWpm: 45,
      accuracy: 0.97,
      integrityStatus: "VERIFIED",
      scoringSource: "SERVER_RECONSTRUCTED",
      userId: "u1",
      session: { trustTier: "CERTIFICATE", duration: 300 },
    };
    expect((getPublicResult(base) as any).isCertificateEligible).toBe(true);
    expect(
      (getPublicResult({ ...base, scoringSource: "CLIENT_COUNTS" }) as any)
        .isCertificateEligible
    ).toBe(false);
    expect(
      (getPublicResult({ ...base, userId: null }) as any).isCertificateEligible
    ).toBe(false);
  });
});
