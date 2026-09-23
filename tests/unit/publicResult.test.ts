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

    // Assert basic properties remain intact
    expect(publicPayload.id).toBe("result-1");
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
});
