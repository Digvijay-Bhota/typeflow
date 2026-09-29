// @vitest-environment happy-dom
/**
 * Live counters and the event trace.
 *
 * Regression (D1): backspacing over a correctly typed character did not take
 * it off correctCharacters (only totalCharacters went down), so live WPM and
 * accuracy grew every time a typist deleted and retyped correct text.
 *
 * The engine's counters now mirror the server's trace reconstruction, and the
 * trace itself is unchanged: these tests replay random typing through the
 * engine and check that
 *   - the trace is exactly the contract's events (one keypress event per
 *     advanced index, one backspace event per backspace), and
 *   - reconstructFinalBuffer / deriveTraceDiagnostics — the authoritative
 *     server scoring — agree with the engine's final counters and maps.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTypingEngine } from "@/features/typing/hooks/useTypingEngine";
import { reconstructFinalBuffer } from "@/features/typing/lib/reconstruct";
import { deriveTraceDiagnostics } from "@/features/typing/lib/traceAnalysis";
import { SubmitResultSchema, type EventTrace } from "@/schemas/result.schema";
import type { TypingEngineState } from "@/types/typing";

afterEach(() => {
  vi.useRealTimers();
});

const PASSAGE = "the quick brown fox jumps over the lazy dog";

function renderEngine(passage = PASSAGE) {
  vi.useFakeTimers({
    toFake: [
      "Date",
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  const onComplete = vi.fn<(s: TypingEngineState) => void>();
  const hook = renderHook(() =>
    useTypingEngine({
      passage,
      mode: "timed",
      language: "english",
      duration: 300,
      onComplete,
    })
  );
  const type = (keys: string) => {
    for (const k of keys) act(() => hook.result.current.handleKey(k));
  };
  const backspace = (n = 1) => {
    for (let i = 0; i < n; i++) act(() => hook.result.current.handleBackspace());
  };
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  const finish = () => {
    act(() => hook.result.current.finish());
    const final = onComplete.mock.calls.at(-1)?.[0];
    if (!final) throw new Error("engine did not complete");
    return final;
  };
  return { hook, type, backspace, wait, finish, onComplete };
}

describe("useTypingEngine — live counters (D1)", () => {
  it("takes a deleted correct character off the correct count", () => {
    const { hook, type, backspace, wait } = renderEngine();
    type("the");
    backspace(3);
    wait(1_000);

    const s = hook.result.current.state;
    expect(s.currentIndex).toBe(0);
    expect(s.correctCharacters).toBe(0); // was 3: nothing typed, yet "3 correct"
    expect(s.wpm).toBe(0);
    expect(s.totalCharacters).toBe(3); // the keystrokes still happened
  });

  it("does not inflate WPM or accuracy when correct text is deleted and retyped", () => {
    const { hook, type, backspace, wait } = renderEngine();
    type("the q");
    backspace(5);
    type("the q");
    wait(1_000);

    const s = hook.result.current.state;
    expect(s.correctCharacters).toBe(5); // was 10
    expect(s.totalCharacters).toBe(10); // was 5
    expect(s.accuracy).toBe(0.5); // was clamped to 1 (10 / 5)
  });

  it("counts a fixed typo as corrected, not as correct or incorrect", () => {
    const { hook, type, backspace, wait } = renderEngine();
    type("tx");
    backspace();
    type("h");
    wait(1_000);

    const s = hook.result.current.state;
    expect(s).toMatchObject({
      correctCharacters: 2,
      incorrectCharacters: 0,
      uncorrectedErrors: 0,
      correctedErrors: 1,
      totalCharacters: 3,
    });
    expect(s.errorMap).toEqual({});
    expect(s.keyErrors.h).toMatchObject({ count: 1, corrected: 1, uncorrected: 0 });
  });
});

describe("useTypingEngine — event trace contract", () => {
  it("records the exact trace for a scripted run", () => {
    const { type, backspace, wait, finish } = renderEngine();
    type("t");
    wait(100);
    type("x"); // wrong: expected "h"
    wait(100);
    backspace();
    wait(100);
    type("h");
    wait(100);
    type("e");
    wait(50);
    backspace();
    backspace();
    backspace();
    backspace(); // at index 0: no event

    const final = finish();
    expect(final.eventTrace?.events).toEqual([
      [0, 0, 0, "t"],
      [100, 0, 1, "x"],
      [200, 1, 1],
      [300, 0, 1, "h"],
      [400, 0, 2, "e"],
      [450, 1, 2],
      [450, 1, 1],
      [450, 1, 0],
    ]);
    expect(final.eventTrace).toMatchObject({ totalEvents: 8, durationMs: 450 });
  });

  // Small deterministic PRNG so failures reproduce.
  function mulberry32(seed: number) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("matches the server's reconstruction and diagnostics on random typing", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rand = mulberry32(seed);
      const { hook, type, backspace, wait, finish, onComplete } = renderEngine();

      // Independent model of the contract: what the trace must contain.
      const expected: EventTrace["events"] = [];
      let idx = 0;
      let t = 0;
      let startedAt: number | null = null; // the clock starts on the first key
      for (let op = 0; op < 120 && onComplete.mock.calls.length === 0; op++) {
        const r = rand();
        if (r < 0.2) {
          if (idx > 0) {
            idx--;
            expected.push([t - (startedAt ?? t), 1, idx]);
          }
          backspace();
        } else {
          const want = PASSAGE[idx] ?? "";
          const ch = r < 0.35 ? "#" : want;
          startedAt ??= t;
          expected.push([t - startedAt, 0, idx, ch]);
          idx++;
          type(ch);
        }
        const step = 20 + Math.floor(rand() * 180);
        wait(step);
        t += step;
      }
      const final =
        onComplete.mock.calls.length > 0 ? onComplete.mock.calls[0]![0] : finish();
      expect(onComplete).toHaveBeenCalledTimes(1);

      const trace = final.eventTrace as EventTrace;
      expect(trace.events, `seed ${seed}`).toEqual(expected);

      const rec = reconstructFinalBuffer(PASSAGE, trace);
      expect(rec.isValidTrace, `seed ${seed}`).toBe(true);
      expect(
        {
          correctChars: final.correctCharacters,
          incorrectChars: final.incorrectCharacters,
          totalChars: final.totalCharacters,
          correctedErrors: final.correctedErrors,
          uncorrectedErrors: final.uncorrectedErrors,
        },
        `seed ${seed}`
      ).toEqual({
        correctChars: rec.correctChars,
        incorrectChars: rec.incorrectChars,
        totalChars: rec.totalChars,
        correctedErrors: rec.correctedErrors,
        uncorrectedErrors: rec.uncorrectedErrors,
      });

      const diag = deriveTraceDiagnostics(PASSAGE, trace);
      expect(final.keyErrors, `seed ${seed}`).toEqual(diag.keyErrors);
      expect(final.errorMap, `seed ${seed}`).toEqual(diag.positionErrors);

      // The submission TypingTest builds from this state is still valid.
      const body = {
        sessionId: "00000000-0000-4000-8000-000000000000",
        integrityToken: "token",
        clientElapsedMs: final.elapsedMs,
        metrics: {
          wpm: final.wpm,
          rawWpm: final.rawWpm,
          accuracy: final.accuracy,
          correctChars: final.correctCharacters,
          incorrectChars: final.incorrectCharacters,
          totalChars: final.totalCharacters,
          correctedErrors: final.correctedErrors,
          uncorrectedErrors: final.uncorrectedErrors,
          consistency: final.consistency,
        },
        errorMap: final.keyErrors,
        integritySignals: final.integritySignals,
        eventTrace: final.eventTrace,
      };
      expect(SubmitResultSchema.safeParse(body).success, `seed ${seed}`).toBe(true);

      hook.unmount();
      vi.useRealTimers();
    }
  });
});
