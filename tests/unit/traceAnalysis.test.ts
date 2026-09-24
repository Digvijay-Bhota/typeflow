import { describe, it, expect } from "vitest";
import { deriveTraceDiagnostics } from "@/features/typing/lib/traceAnalysis";
import { calculateCodeMetrics } from "@/features/typing/lib/codeMetrics";
import { calculateConsistency } from "@/features/typing/lib/metrics";

type Event = [number, 0, number, string] | [number, 1, number];
const trace = (events: Event[]) => ({
  events,
  totalEvents: events.length,
  durationMs: events.at(-1)?.[0] ?? 0,
});

describe("deriveTraceDiagnostics", () => {
  it("records a wrong key as an uncorrected key error and a position error", () => {
    const d = deriveTraceDiagnostics(
      "abc",
      trace([
        [100, 0, 0, "a"],
        [200, 0, 1, "x"],
      ])
    );

    expect(d.keyErrors).toEqual({
      b: { expected: "b", actual: ["x"], count: 1, corrected: 0, uncorrected: 1 },
    });
    expect(d.positionErrors).toEqual({
      1: { expected: "b", typed: "x", corrected: false },
    });
  });

  it("marks a backspaced error as corrected, like the client engine", () => {
    const d = deriveTraceDiagnostics(
      "abc",
      trace([
        [100, 0, 0, "a"],
        [200, 0, 1, "x"],
        [300, 1, 1],
      ])
    );

    expect(d.keyErrors.b).toMatchObject({ count: 1, corrected: 1, uncorrected: 0 });
    expect(d.positionErrors[1]).toEqual({ expected: "b", typed: "x", corrected: true });
  });

  it("clears the position error once the position is retyped correctly", () => {
    const d = deriveTraceDiagnostics(
      "abc",
      trace([
        [100, 0, 0, "a"],
        [200, 0, 1, "x"],
        [300, 1, 1],
        [400, 0, 1, "b"],
      ])
    );

    expect(d.positionErrors).toEqual({});
    // The key-level history keeps the (corrected) mistake.
    expect(d.keyErrors.b).toMatchObject({ count: 1, corrected: 1, uncorrected: 0 });
  });

  it("keeps at most the last 5 wrong keys per expected key", () => {
    const events: Event[] = [];
    let t = 0;
    for (const wrong of ["1", "2", "3", "4", "5", "6"]) {
      events.push([(t += 10), 0, 0, wrong], [(t += 10), 1, 0]);
    }
    const d = deriveTraceDiagnostics("a", trace(events));

    expect(d.keyErrors.a!.actual).toEqual(["2", "3", "4", "5", "6"]);
    expect(d.keyErrors.a!.count).toBe(6);
  });

  it("samples interval WPM at 5 s boundaries from the final buffer", () => {
    const passage = "x".repeat(100);
    // One correct char every 250 ms for 15 s → 60 chars.
    const events: Event[] = Array.from(
      { length: 60 },
      (_, i) => [(i + 1) * 250, 0, i, "x"] as Event
    );
    const d = deriveTraceDiagnostics(passage, trace(events));

    // 19 chars by 5 s, 39 by 10 s, 59 by 15 s (the 60th lands exactly at 15 s).
    expect(d.intervalWpms).toEqual([45.6, 46.8, 47.2]);
    expect(d.consistency).toBe(calculateConsistency(d.intervalWpms));
  });

  it("does not let typing and deleting correct chars inflate interval WPM", () => {
    const passage = "x".repeat(100);
    const events: Event[] = [];
    // 50 type-then-delete pairs, all finished before the 5 s boundary.
    for (let i = 0; i < 50; i++) {
      events.push([i * 100 + 10, 0, 0, "x"], [i * 100 + 60, 1, 0]);
    }
    events.push([5_500, 0, 0, "x"]);
    const d = deriveTraceDiagnostics(passage, trace(events));

    // At 5 s the buffer is empty, even though 50 correct keypresses happened.
    expect(d.intervalWpms).toEqual([0]);
  });

  it("returns null consistency for traces shorter than three intervals", () => {
    const d = deriveTraceDiagnostics("ab", trace([[100, 0, 0, "a"]]));
    expect(d.intervalWpms).toEqual([]);
    expect(d.consistency).toBeNull();
  });

  it("feeds code metrics per-position errors, not per-key ones", () => {
    const code = "a;\n  b;";
    const d = deriveTraceDiagnostics(
      code,
      trace([
        [100, 0, 0, "a"],
        [200, 0, 1, ","], // wrong punctuation, left uncorrected
        [300, 0, 2, "\n"],
        [400, 0, 3, " "],
        [500, 0, 4, "\t"], // wrong indentation, left uncorrected
      ])
    );
    const metrics = calculateCodeMetrics(code, d.positionErrors);

    expect(metrics.punctuationErrors).toBe(1);
    expect(metrics.indentationErrors).toBe(1);
  });
});
