// @vitest-environment happy-dom
/**
 * Live speed does not spike at the start of a test.
 *
 * Regression: the first frame after the first keystroke is ~16 ms in, so one
 * character showed as ~750 WPM before settling. Live speeds are now measured
 * over at least one second; the completed (submitted) state still uses the
 * real elapsed time.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTypingEngine } from "@/features/typing/hooks/useTypingEngine";
import {
  LIVE_SPEED_MIN_ELAPSED_MS,
  calculateWpm,
  liveSpeedElapsedMs,
} from "@/features/typing/lib/metrics";
import type { TypingEngineState } from "@/types/typing";

afterEach(() => {
  vi.useRealTimers();
});

describe("liveSpeedElapsedMs", () => {
  it("floors the time base at one second", () => {
    expect(LIVE_SPEED_MIN_ELAPSED_MS).toBe(1_000);
    expect(liveSpeedElapsedMs(0)).toBe(1_000);
    expect(liveSpeedElapsedMs(16)).toBe(1_000);
    expect(liveSpeedElapsedMs(1_000)).toBe(1_000);
    expect(liveSpeedElapsedMs(4_321)).toBe(4_321);
  });
});

function renderEngine() {
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
      passage: "the quick brown fox jumps over the lazy dog",
      mode: "timed",
      language: "english",
      duration: 60,
      onComplete,
    })
  );
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  return { hook, wait, onComplete };
}

describe("useTypingEngine — live WPM", () => {
  it("does not flash hundreds of WPM on the first frame", () => {
    const { hook, wait } = renderEngine();
    act(() => hook.result.current.handleKey("t"));
    wait(16);

    const s = hook.result.current.state;
    expect(s.correctCharacters).toBe(1);
    expect(s.wpm).toBe(12); // 1 char over 1 s; was 750 over 16 ms
    expect(s.wpm).toBeLessThan(calculateWpm(1, 16));
    expect(s.rawWpm).toBe(12);
  });

  it("uses the real elapsed time once a second has passed", () => {
    const { hook, wait } = renderEngine();
    for (const k of "the quick ") {
      act(() => hook.result.current.handleKey(k));
      wait(200);
    }
    // 10 correct characters in 2 s.
    expect(hook.result.current.state.wpm).toBe(calculateWpm(10, 2_000));
  });

  it("scores the completed test on the real elapsed time", () => {
    const { hook, wait, onComplete } = renderEngine();
    for (const k of "the q") {
      act(() => hook.result.current.handleKey(k));
      wait(100);
    }
    expect(hook.result.current.state.wpm).toBe(60); // live: 5 chars over 1 s

    act(() => hook.result.current.finish());
    const final = onComplete.mock.calls[0]![0];
    expect(final.elapsedMs).toBe(500);
    expect(final.wpm).toBe(120); // 5 chars over the real 0.5 s
    expect(final.wpm).toBe(calculateWpm(5, 500));
  });
});
