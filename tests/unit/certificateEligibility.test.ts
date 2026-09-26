import { describe, it, expect } from "vitest";
import {
  evaluateCertificateEligibility,
  isTrustedResult,
} from "@/lib/certificateEligibility";
import {
  CERTIFICATE_MIN_ACCURACY,
  CERTIFICATE_MIN_DURATION,
  CERTIFICATE_MIN_WPM,
} from "@/lib/constants";

const eligible = {
  netWpm: CERTIFICATE_MIN_WPM,
  accuracy: CERTIFICATE_MIN_ACCURACY / 100,
  duration: CERTIFICATE_MIN_DURATION,
  integrityStatus: "VERIFIED",
  scoringSource: "SERVER_RECONSTRUCTED",
  trustTier: "CERTIFICATE",
  userId: "u1",
};

describe("isTrustedResult", () => {
  it.each([
    ["VERIFIED", "SERVER_RECONSTRUCTED", true],
    ["VERIFIED", "CLIENT_COUNTS", false],
    ["REVIEW", "SERVER_RECONSTRUCTED", false],
    ["INVALID", "SERVER_RECONSTRUCTED", false],
  ])("%s + %s → %s", (integrityStatus, scoringSource, expected) => {
    expect(isTrustedResult({ integrityStatus, scoringSource })).toBe(expected);
  });
});

describe("evaluateCertificateEligibility", () => {
  it("accepts a result exactly at every threshold", () => {
    const r = evaluateCertificateEligibility(eligible);
    expect(r.eligible).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it.each([
    [
      "net WPM just below minimum",
      { netWpm: CERTIFICATE_MIN_WPM - 0.1 },
      "Net WPM below minimum",
    ],
    [
      "accuracy just below minimum",
      { accuracy: CERTIFICATE_MIN_ACCURACY / 100 - 0.001 },
      "Accuracy below minimum",
    ],
    [
      "duration below minimum",
      { duration: CERTIFICATE_MIN_DURATION - 1 },
      "duration below minimum",
    ],
    ["missing duration", { duration: null }, "duration below minimum"],
    ["CLIENT_COUNTS", { scoringSource: "CLIENT_COUNTS" }, "SERVER_RECONSTRUCTED"],
    ["REVIEW", { integrityStatus: "REVIEW" }, "must be VERIFIED"],
    ["INVALID", { integrityStatus: "INVALID" }, "must be VERIFIED"],
    ["FREE tier", { trustTier: "FREE" }, "not taken in CERTIFICATE trust tier"],
    ["B2B tier", { trustTier: "B2B_ASSESSMENT" }, "not taken in CERTIFICATE trust tier"],
    ["guest", { userId: null }, "User must be authenticated"],
  ])("rejects %s", (_label, override, reason) => {
    const r = evaluateCertificateEligibility({ ...eligible, ...override });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(" | ")).toContain(reason);
  });

  it("reports actual vs required thresholds", () => {
    const r = evaluateCertificateEligibility({
      ...eligible,
      netWpm: 12.5,
      accuracy: 0.5,
    });
    expect(r.thresholdSummary.wpm).toEqual({
      actual: 12.5,
      required: CERTIFICATE_MIN_WPM,
      passed: false,
    });
    expect(r.thresholdSummary.accuracy.actual).toBe(50);
  });
});

describe("eligibleOnceSignedIn", () => {
  it("is true for an unclaimed guest result that meets every other requirement", () => {
    const r = evaluateCertificateEligibility({ ...eligible, userId: null });
    expect(r.eligible).toBe(false);
    expect(r.eligibleOnceSignedIn).toBe(true);
  });

  it("is false when anything other than sign-in is missing", () => {
    expect(
      evaluateCertificateEligibility({ ...eligible, userId: null, netWpm: 1 })
        .eligibleOnceSignedIn
    ).toBe(false);
    expect(
      evaluateCertificateEligibility({
        ...eligible,
        userId: null,
        scoringSource: "CLIENT_COUNTS",
      }).eligibleOnceSignedIn
    ).toBe(false);
  });
});
