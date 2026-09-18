/**
 * Unit tests for typing metrics module.
 *
 * Tests all documented formulas:
 * - WPM
 * - Raw WPM
 * - Net WPM
 * - Accuracy
 * - Error rate
 * - CPM
 * - KSPM
 * - Consistency
 * - Key classification
 * - Error analysis
 * - Certificate eligibility
 * - Integrity classification
 */
import { describe, it, expect } from "vitest";
import {
  calculateWpm,
  calculateRawWpm,
  calculateNetWpm,
  calculateAccuracy,
  calculateErrorRate,
  calculateCpm,
  calculateKspm,
  calculateConsistency,
  getWeakKeys,
  classifyKey,
  analyzeErrorsByCategory,
  isCertificateEligible,
  classifyIntegrity,
} from "@/features/typing/lib/metrics";

// ─── WPM ─────────────────────────────────────────────────────────────────────

describe("calculateWpm", () => {
  it("returns 0 for zero elapsed time", () => {
    expect(calculateWpm(100, 0)).toBe(0);
  });

  it("returns 0 for negative elapsed time", () => {
    expect(calculateWpm(100, -1000)).toBe(0);
  });

  it("calculates correctly: 100 chars in 1 minute = 20 WPM", () => {
    // 100 chars / 5 chars-per-word / 1 minute = 20 WPM
    expect(calculateWpm(100, 60_000)).toBe(20);
  });

  it("calculates correctly: 300 chars in 1 minute = 60 WPM", () => {
    expect(calculateWpm(300, 60_000)).toBe(60);
  });

  it("calculates correctly: 150 chars in 30 seconds = 60 WPM", () => {
    // 150 / 5 / 0.5 = 60
    expect(calculateWpm(150, 30_000)).toBe(60);
  });

  it("rounds to 1 decimal place", () => {
    // 101 / 5 / 1 = 20.2
    expect(calculateWpm(101, 60_000)).toBe(20.2);
  });
});

// ─── Raw WPM ──────────────────────────────────────────────────────────────────

describe("calculateRawWpm", () => {
  it("returns 0 for zero elapsed time", () => {
    expect(calculateRawWpm(100, 0)).toBe(0);
  });

  it("includes all characters (correct + incorrect)", () => {
    // 300 total chars (including 30 errors) in 1 minute = 60 raw WPM
    expect(calculateRawWpm(300, 60_000)).toBe(60);
  });

  it("raw WPM >= WPM for any input with errors", () => {
    const correct = 250;
    const total = 280; // 30 errors
    const elapsed = 60_000;
    const wpm = calculateWpm(correct, elapsed);
    const rawWpm = calculateRawWpm(total, elapsed);
    expect(rawWpm).toBeGreaterThanOrEqual(wpm);
  });
});

// ─── Net WPM ─────────────────────────────────────────────────────────────────

describe("calculateNetWpm", () => {
  it("returns 0 for zero elapsed time", () => {
    expect(calculateNetWpm(60, 5, 0)).toBe(0);
  });

  it("equals WPM when no uncorrected errors", () => {
    const wpm = calculateWpm(300, 60_000);
    const netWpm = calculateNetWpm(wpm, 0, 60_000);
    expect(netWpm).toBe(wpm);
  });

  it("penalizes uncorrected errors: 60 WPM, 3 errors in 1 min = 57 WPM net", () => {
    // Net = 60 - (3 / 1) = 57
    expect(calculateNetWpm(60, 3, 60_000)).toBe(57);
  });

  it("clamps to 0 (cannot be negative)", () => {
    expect(calculateNetWpm(10, 100, 60_000)).toBe(0);
  });

  it("penalizes proportionally to time: 60 WPM, 3 errors in 2 min", () => {
    // Net = 60 - (3 / 2) = 58.5
    expect(calculateNetWpm(60, 3, 120_000)).toBe(58.5);
  });
});

// ─── Accuracy ─────────────────────────────────────────────────────────────────

describe("calculateAccuracy", () => {
  it("returns 1.0 when nothing typed", () => {
    expect(calculateAccuracy(0, 0)).toBe(1);
  });

  it("returns 1.0 for perfect typing", () => {
    expect(calculateAccuracy(100, 100)).toBe(1);
  });

  it("calculates 90% accuracy correctly", () => {
    expect(calculateAccuracy(90, 100)).toBe(0.9);
  });

  it("clamps to 1.0 (edge case: correctChars > totalChars)", () => {
    expect(calculateAccuracy(110, 100)).toBe(1);
  });

  it("handles non-round percentages", () => {
    // 96 / 100 = 0.96
    expect(calculateAccuracy(96, 100)).toBeCloseTo(0.96, 5);
  });
});

// ─── Error Rate ───────────────────────────────────────────────────────────────

describe("calculateErrorRate", () => {
  it("returns 0 when nothing typed", () => {
    expect(calculateErrorRate(0, 0)).toBe(0);
  });

  it("returns 0 for no errors", () => {
    expect(calculateErrorRate(0, 100)).toBe(0);
  });

  it("returns 0.1 for 10% error rate", () => {
    expect(calculateErrorRate(10, 100)).toBeCloseTo(0.1, 5);
  });

  it("is approximately 1 - accuracy", () => {
    const correct = 90;
    const total = 100;
    const acc = calculateAccuracy(correct, total);
    const errRate = calculateErrorRate(total - correct, total);
    expect(errRate).toBeCloseTo(1 - acc, 5);
  });
});

// ─── CPM ──────────────────────────────────────────────────────────────────────

describe("calculateCpm", () => {
  it("returns 0 for zero elapsed time", () => {
    expect(calculateCpm(100, 0)).toBe(0);
  });

  it("calculates: 300 correct chars in 1 minute = 300 CPM", () => {
    expect(calculateCpm(300, 60_000)).toBe(300);
  });

  it("CPM = WPM * 5 for standard passages", () => {
    const elapsed = 60_000;
    const correct = 300;
    const wpm = calculateWpm(correct, elapsed);
    const cpm = calculateCpm(correct, elapsed);
    expect(cpm).toBeCloseTo(wpm * 5, 0);
  });
});

// ─── KSPM ─────────────────────────────────────────────────────────────────────

describe("calculateKspm", () => {
  it("returns 0 for zero elapsed time", () => {
    expect(calculateKspm(100, 0)).toBe(0);
  });

  it("calculates correctly", () => {
    // 360 keystrokes in 1 minute = 360 KSPM
    expect(calculateKspm(360, 60_000)).toBe(360);
  });
});

// ─── Consistency ──────────────────────────────────────────────────────────────

describe("calculateConsistency", () => {
  it("returns null with fewer than 3 data points", () => {
    expect(calculateConsistency([])).toBeNull();
    expect(calculateConsistency([60])).toBeNull();
    expect(calculateConsistency([60, 65])).toBeNull();
  });

  it("returns 1.0 for perfectly consistent speed", () => {
    // All same WPM → stdDev = 0 → CV = 0 → consistency = 1
    const result = calculateConsistency([60, 60, 60, 60, 60]);
    expect(result).toBeCloseTo(1.0, 5);
  });

  it("returns a value in [0, 1] for normal input", () => {
    const result = calculateConsistency([40, 60, 55, 70, 45, 65]);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(0);
    expect(result!).toBeLessThanOrEqual(1);
  });

  it("returns lower value for highly inconsistent speed", () => {
    const consistent = calculateConsistency([60, 61, 60, 59, 60]);
    const inconsistent = calculateConsistency([10, 100, 20, 90, 30]);
    expect(consistent!).toBeGreaterThan(inconsistent!);
  });

  it("returns null when all values are 0", () => {
    expect(calculateConsistency([0, 0, 0])).toBeNull();
  });
});

// ─── Key Classification ───────────────────────────────────────────────────────

describe("classifyKey", () => {
  it("classifies lowercase letters as alphabetic", () => {
    expect(classifyKey("a")).toBe("alphabetic");
    expect(classifyKey("z")).toBe("alphabetic");
  });

  it("classifies uppercase letters as uppercase", () => {
    expect(classifyKey("A")).toBe("uppercase");
    expect(classifyKey("Z")).toBe("uppercase");
  });

  it("classifies digits as numeric", () => {
    expect(classifyKey("0")).toBe("numeric");
    expect(classifyKey("9")).toBe("numeric");
  });

  it("classifies punctuation correctly", () => {
    expect(classifyKey(".")).toBe("punctuation");
    expect(classifyKey(",")).toBe("punctuation");
    expect(classifyKey(";")).toBe("punctuation");
    expect(classifyKey("!")).toBe("punctuation");
  });

  it("classifies brackets correctly", () => {
    expect(classifyKey("[")).toBe("bracket");
    expect(classifyKey("{")).toBe("bracket");
    expect(classifyKey("(")).toBe("bracket");
    expect(classifyKey("<")).toBe("bracket");
  });

  it("classifies operators correctly", () => {
    expect(classifyKey("+")).toBe("operator");
    expect(classifyKey("=")).toBe("operator");
    expect(classifyKey("*")).toBe("operator");
  });

  it("classifies whitespace correctly", () => {
    expect(classifyKey(" ")).toBe("whitespace");
    expect(classifyKey("\n")).toBe("whitespace");
    expect(classifyKey("\t")).toBe("whitespace");
  });
});

// ─── Weak Keys ────────────────────────────────────────────────────────────────

describe("getWeakKeys", () => {
  it("returns keys sorted by error count descending", () => {
    const errors = {
      a: { expected: "a", actual: ["s"], count: 5, corrected: 2, uncorrected: 3 },
      s: { expected: "s", actual: ["d"], count: 10, corrected: 5, uncorrected: 5 },
      d: { expected: "d", actual: ["f"], count: 2, corrected: 1, uncorrected: 1 },
    };
    const weak = getWeakKeys(errors, 3);
    expect(weak[0]?.key).toBe("s");
    expect(weak[1]?.key).toBe("a");
    expect(weak[2]?.key).toBe("d");
  });

  it("respects topN limit", () => {
    const errors: Record<string, { expected: string; actual: string[]; count: number; corrected: number; uncorrected: number }> = {};
    for (let i = 0; i < 20; i++) {
      const k = String.fromCharCode(97 + i);
      errors[k] = { expected: k, actual: ["x"], count: i + 1, corrected: 0, uncorrected: i + 1 };
    }
    const weak = getWeakKeys(errors, 5);
    expect(weak).toHaveLength(5);
  });

  it("returns empty array for no errors", () => {
    expect(getWeakKeys({}, 10)).toHaveLength(0);
  });
});

// ─── Error Category Analysis ──────────────────────────────────────────────────

describe("analyzeErrorsByCategory", () => {
  it("groups errors by character category", () => {
    const errors = {
      a: { count: 5 },
      A: { count: 3 },
      "1": { count: 2 },
      ".": { count: 4 },
    };
    const result = analyzeErrorsByCategory(errors);
    expect(result.alphabetic).toBe(5);
    expect(result.uppercase).toBe(3);
    expect(result.numeric).toBe(2);
    expect(result.punctuation).toBe(4);
  });
});

// ─── Certificate Eligibility ──────────────────────────────────────────────────

describe("isCertificateEligible", () => {
  const base = {
    wpm: 45,
    accuracy: 0.96,
    durationSeconds: 300,
    integrityStatus: "VERIFIED" as const,
    minWpm: 30,
    minAccuracy: 90,
    minDuration: 300,
  };

  it("returns eligible for passing result", () => {
    expect(isCertificateEligible(base).eligible).toBe(true);
  });

  it("rejects INVALID integrity", () => {
    const result = isCertificateEligible({
      ...base,
      integrityStatus: "INVALID",
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("integrity");
  });

  it("rejects short duration", () => {
    const result = isCertificateEligible({ ...base, durationSeconds: 60 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("minimum");
  });

  it("rejects WPM below threshold", () => {
    const result = isCertificateEligible({ ...base, wpm: 25 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("WPM");
  });

  it("rejects accuracy below threshold", () => {
    const result = isCertificateEligible({ ...base, accuracy: 0.85 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("accuracy");
  });

  it("allows REVIEW integrity (borderline)", () => {
    const result = isCertificateEligible({
      ...base,
      integrityStatus: "REVIEW",
    });
    // REVIEW is not INVALID — still eligible (server may flag for human review)
    expect(result.eligible).toBe(true);
  });
});

// ─── Integrity Classification ─────────────────────────────────────────────────

describe("classifyIntegrity", () => {
  const base = {
    pasteAttempts: 0,
    copyAttempts: 0,
    focusLossCount: 0,
    visibilityChanges: 0,
    suspiciousPattern: false,
    wpm: 60,
    maxPlausibleWpm: 300,
    minKeystrokeIntervalMs: 20,
    durationMs: 60_000,
    expectedDurationMs: 60_000,
  };

  it("returns VERIFIED for clean session", () => {
    expect(classifyIntegrity(base)).toBe("VERIFIED");
  });

  it("returns INVALID for paste attempt", () => {
    expect(
      classifyIntegrity({ ...base, pasteAttempts: 1 })
    ).toBe("INVALID");
  });

  it("returns INVALID for WPM above human maximum", () => {
    expect(
      classifyIntegrity({ ...base, wpm: 350 })
    ).toBe("INVALID");
  });

  it("returns INVALID for suspicious pattern", () => {
    expect(
      classifyIntegrity({ ...base, suspiciousPattern: true })
    ).toBe("INVALID");
  });

  it("returns INVALID for duration anomaly (completed too fast)", () => {
    // Expected 60s test but completed in 10s (>15% faster)
    expect(
      classifyIntegrity({ ...base, durationMs: 10_000, expectedDurationMs: 60_000 })
    ).toBe("INVALID");
  });

  it("returns REVIEW for focus loss", () => {
    expect(
      classifyIntegrity({ ...base, focusLossCount: 1 })
    ).toBe("REVIEW");
  });

  it("returns REVIEW for many visibility changes", () => {
    expect(
      classifyIntegrity({ ...base, visibilityChanges: 3 })
    ).toBe("REVIEW");
  });
});
