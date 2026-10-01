import { describe, it, expect } from "vitest";
import {
  assessTracePlausibility,
  plausibilityToIntegrity,
  type TraceEvents,
} from "@/features/typing/lib/tracePlausibility";

/** Deterministic pseudo-random numbers in [0, 1), so the tests never flake. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Human-like gaps: a floor plus an exponential tail (variation well above 0.25). */
function humanGaps(count: number, floor: number, tailMean: number, seed: number) {
  const random = lcg(seed);
  return Array.from({ length: count }, () =>
    Math.round(floor - Math.log(1 - random()) * tailMean)
  );
}

/** One key press per gap, plus a first press at `start`. */
function traceFromGaps(gaps: readonly number[], start = 500): TraceEvents {
  const events: TraceEvents = [];
  let time = start;
  events.push([time, 0, 0, "a"]);
  gaps.forEach((gap, i) => {
    time += gap;
    events.push([time, 0, i + 1, "a"]);
  });
  return events;
}

const FIVE_MINUTES = 300_000;
const STRICT = { durationMs: FIVE_MINUTES, expectFullDuration: true };

describe("assessTracePlausibility", () => {
  it("accepts a steady human-like trace", () => {
    const events = traceFromGaps(humanGaps(330, 80, 120, 1));
    const result = assessTracePlausibility(events, {
      durationMs: 60_000,
      expectFullDuration: true,
    });
    expect(result.verdict).toBe("OK");
    expect(result.reasons).toEqual([]);
    expect(result.metrics.coverage).toBeGreaterThan(0.9);
    expect(result.metrics.peakWindowWpm).toBeLessThan(200);
  });

  it("rejects a burst: every keystroke packed into the first seconds", () => {
    const events: TraceEvents = [];
    for (let i = 0; i < 1250; i++) {
      events.push([500 + Math.floor(i * 2.4), 0, i, "a"]);
    }
    const result = assessTracePlausibility(events, STRICT);
    expect(result.verdict).toBe("INVALID");
    expect(result.reasons.join(" ")).toMatch(/peak speed/i);
    expect(result.reasons.join(" ")).toMatch(/cover only/i);
    expect(plausibilityToIntegrity(result)).toBe("INVALID");
  });

  it("sends an unnaturally uniform trace to review", () => {
    const events = traceFromGaps(Array.from({ length: 1249 }, () => 240));
    const result = assessTracePlausibility(events, STRICT);
    expect(result.verdict).toBe("REVIEW");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/vary too little/i);
    expect(plausibilityToIntegrity(result)).toBe("REVIEW");
  });

  it("sends a trace that stops early to review when the full duration is expected", () => {
    const events = traceFromGaps(humanGaps(1500, 40, 40, 7));
    const result = assessTracePlausibility(events, STRICT);
    expect(result.verdict).toBe("REVIEW");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/cover only/i);
  });

  it("does not check coverage when the full duration is not expected", () => {
    const events = traceFromGaps(humanGaps(1500, 40, 40, 7));
    const result = assessTracePlausibility(events, {
      durationMs: FIVE_MINUTES,
      expectFullDuration: false,
    });
    expect(result.verdict).toBe("OK");
    expect(result.metrics.coverage).toBeNull();
  });

  it("sends a trace with many near-simultaneous keystrokes to review", () => {
    const gaps = Array.from({ length: 999 }, (_, i) => (i % 2 === 0 ? 0 : 400));
    const result = assessTracePlausibility(traceFromGaps(gaps), {
      durationMs: 200_000,
      expectFullDuration: true,
    });
    expect(result.verdict).toBe("REVIEW");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/gaps between keystrokes are under/i);
  });

  it("lets callers override thresholds", () => {
    const events = traceFromGaps(humanGaps(1500, 40, 40, 7));
    const result = assessTracePlausibility(events, {
      ...STRICT,
      thresholds: { coverageReviewBelow: 0.2 },
    });
    expect(result.verdict).toBe("OK");
    expect(result.reasons).toEqual([]);
  });

  it("skips the statistics when there are too few keystrokes", () => {
    const result = assessTracePlausibility(traceFromGaps([100, 100, 100]), STRICT);
    expect(result.verdict).toBe("OK");
    expect(result.insufficientData).toBe(true);
    expect(result.metrics.keystrokes).toBe(4);
  });

  it("rejects timestamps that go backwards", () => {
    const events: TraceEvents = [
      [100, 0, 0, "a"],
      [50, 0, 1, "b"],
    ];
    const result = assessTracePlausibility(events, STRICT);
    expect(result.verdict).toBe("INVALID");
    expect(result.reasons[0]).toMatch(/out of order/i);
  });
});

describe("plausibilityToIntegrity", () => {
  it("maps each verdict onto an integrity status", () => {
    expect(plausibilityToIntegrity({ verdict: "OK" })).toBe("VERIFIED");
    expect(plausibilityToIntegrity({ verdict: "REVIEW" })).toBe("REVIEW");
    expect(plausibilityToIntegrity({ verdict: "INVALID" })).toBe("INVALID");
  });
});
