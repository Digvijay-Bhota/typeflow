// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTypingEngine } from "@/features/typing/hooks/useTypingEngine";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderEngine(overrides = {}) {
  vi.useFakeTimers({
    toFake: [
      "Date",
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  const onComplete = vi.fn();
  const hook = renderHook(
    (props) =>
      useTypingEngine({
        passage: "a b c d e",
        mode: "timed",
        language: "english",
        duration: 15,
        onComplete,
        ...props,
      }),
    { initialProps: overrides }
  );
  return { hook, onComplete };
}

describe("useTypingEngine lifecycle", () => {
  it("pause stops timer accumulation and resume restarts timer correctly", () => {
    const { hook } = renderEngine();
    act(() => hook.result.current.start());
    act(() => hook.result.current.handleKey("a"));
    expect(hook.result.current.state.status).toBe("active");

    act(() => vi.advanceTimersByTime(5000));
    act(() => hook.result.current.pause());

    // Test is paused for 10 seconds. Elapsed time should NOT count this.
    act(() => vi.advanceTimersByTime(10000));

    act(() => hook.result.current.resume());
    expect(hook.result.current.state.status).toBe("active");

    // Only 5s have truly elapsed for the test. We need 10s more.
    act(() => vi.advanceTimersByTime(9900));
    expect(hook.result.current.state.status).toBe("active"); // 14.9s elapsed

    act(() => vi.advanceTimersByTime(100));
    expect(hook.result.current.state.status).toBe("completed"); // 15.0s elapsed
  });

  it("resets engine correctly on identical passage but changed sessionId", () => {
    const { hook } = renderEngine({ sessionId: "sess1" });
    act(() => hook.result.current.start());
    act(() => hook.result.current.handleKey("a"));
    act(() => hook.result.current.handleKey(" "));
    act(() => hook.result.current.handleKey("b"));

    act(() => vi.advanceTimersByTime(16));
    expect(hook.result.current.state.currentIndex).toBe(3);

    // Re-render with the exact same passage string, but a new session ID
    hook.rerender({ sessionId: "sess2" });

    expect(hook.result.current.state.status).toBe("idle");
    expect(hook.result.current.state.currentIndex).toBe(0);
  });
});
