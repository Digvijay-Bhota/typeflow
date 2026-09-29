// @vitest-environment happy-dom
/**
 * Timed tests end at their deadline without relying on animation frames.
 *
 * Regression (U5): timer expiry was only noticed inside the
 * requestAnimationFrame loop, which browsers pause in a background tab. A
 * test left running in a hidden tab only ended when the tab was shown again,
 * possibly minutes late, and the server then rejected the result because the
 * session had run past its duration plus grace period. A timeout armed for
 * the deadline now finishes the test on time; the frame loop still does too,
 * and whichever runs first wins.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { useTypingEngine } from "@/features/typing/hooks/useTypingEngine";
import { renderReadyTypingTest } from "../setup/typingTestHarness";
import type { TypingEngineState } from "@/types/typing";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const DURATION_S = 15;
const DURATION_MS = DURATION_S * 1000;
const PASSAGE = "the quick brown fox jumps over the lazy dog";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  push.mockReset();
});

type FrameMode = "normal" | "stopped" | "throttled";

/**
 * Fakes the clock and timers. "stopped" never runs animation frames (a
 * background tab); "throttled" runs them only every 7 s.
 */
function installClock(frames: FrameMode) {
  vi.useFakeTimers({
    toFake:
      frames === "normal"
        ? [
            "Date",
            "setTimeout",
            "clearTimeout",
            "requestAnimationFrame",
            "cancelAnimationFrame",
          ]
        : ["Date", "setTimeout", "clearTimeout"],
  });
  if (frames === "stopped") {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1)
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  } else if (frames === "throttled") {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 7_000)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) =>
      clearTimeout(id)
    );
  }
}

function renderTimedEngine(
  frames: FrameMode,
  opts: { mode?: "timed" | "words"; wordCount?: 10 } = {}
) {
  installClock(frames);
  const onComplete = vi.fn<(s: TypingEngineState) => void>();
  const hook = renderHook(() =>
    useTypingEngine({
      passage: PASSAGE,
      mode: opts.mode ?? "timed",
      language: "english",
      duration: opts.mode === "words" ? undefined : DURATION_S,
      wordCount: opts.wordCount,
      onComplete,
    })
  );
  return { hook, onComplete };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("useTypingEngine — deadline completion", () => {
  it("completes exactly once at normal expiry", () => {
    const { hook, onComplete } = renderTimedEngine("normal");
    act(() => hook.result.current.handleKey("t"));

    advance(DURATION_MS - 1);
    expect(onComplete).not.toHaveBeenCalled();
    advance(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({
      status: "completed",
      elapsedMs: DURATION_MS,
    });

    // The frame loop reaching the deadline too must not complete again.
    advance(DURATION_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.status).toBe("completed");
  });

  it("completes on time when animation frames never run (background tab)", () => {
    const { hook, onComplete } = renderTimedEngine("stopped");
    act(() => hook.result.current.handleKey("t"));
    act(() => hook.result.current.handleKey("h"));

    advance(DURATION_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
    const final = onComplete.mock.calls[0]![0];
    expect(final.elapsedMs).toBe(DURATION_MS);
    expect(final.correctCharacters).toBe(2);
    expect(final.eventTrace).toMatchObject({
      events: [
        [0, 0, 0, "t"],
        [0, 0, 1, "h"],
      ],
      durationMs: DURATION_MS,
    });

    advance(60_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("completes at the deadline, not at the next throttled frame", () => {
    const { hook, onComplete } = renderTimedEngine("throttled");
    act(() => hook.result.current.handleKey("t"));

    // Frames land at 7 s and 14 s, then 21 s: 6 s late, past the server's
    // 5 s grace period. The deadline timeout ends the test at 15 s.
    advance(DURATION_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0].elapsedMs).toBe(DURATION_MS);

    advance(10_000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("moves the deadline by the time spent paused", () => {
    const { hook, onComplete } = renderTimedEngine("stopped");
    act(() => hook.result.current.handleKey("t"));
    advance(5_000);
    act(() => hook.result.current.pause());
    advance(20_000);
    act(() => hook.result.current.resume());

    advance(DURATION_MS - 5_000 - 1);
    expect(onComplete).not.toHaveBeenCalled();
    advance(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0].elapsedMs).toBe(DURATION_MS);
  });

  it("drops the deadline on reset and on a new passage", () => {
    const { hook, onComplete } = renderTimedEngine("stopped");
    act(() => hook.result.current.handleKey("t"));
    act(() => hook.result.current.reset());
    advance(DURATION_MS * 2);
    expect(onComplete).not.toHaveBeenCalled();
    expect(hook.result.current.state.status).toBe("idle");
  });

  it("drops the deadline on unmount", () => {
    const { hook, onComplete } = renderTimedEngine("stopped");
    act(() => hook.result.current.handleKey("t"));
    hook.unmount();
    advance(DURATION_MS * 2);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("arms no deadline for an untimed (words) test", () => {
    const { hook, onComplete } = renderTimedEngine("stopped", {
      mode: "words",
      wordCount: 10,
    });
    act(() => hook.result.current.handleKey("t"));
    advance(10 * 60_000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(hook.result.current.state.status).toBe("active");
  });
});

describe("TypingTest — a hidden tab still submits on time", () => {
  it("POSTs /api/result exactly once when animation frames never run", async () => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/session/create") {
        return json({
          sessionId: "sess_hidden",
          integrityToken: "hidden-token",
          passage: { id: "p-hidden", content: PASSAGE },
        });
      }
      if (url === "/api/session/start") return json({ ok: true });
      if (url === "/api/result") return json({ shareUrl: "/result/share_hidden" });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const textbox = await renderReadyTypingTest({
      mode: "timed",
      language: "english",
      duration: DURATION_S,
      hideConfig: true,
    });

    installClock("stopped");
    fireEvent.keyDown(textbox, { key: "t" });
    await act(async () => {
      vi.advanceTimersByTime(DURATION_MS);
    });
    vi.useRealTimers();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/result/share_hidden"));
    const resultCalls = () =>
      fetchMock.mock.calls.filter(([input]) => String(input) === "/api/result");
    expect(resultCalls()).toHaveLength(1);
    const body = JSON.parse(String(resultCalls()[0]?.[1]?.body));
    expect(body).toMatchObject({
      sessionId: "sess_hidden",
      clientElapsedMs: DURATION_MS,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(resultCalls()).toHaveLength(1);
  });
});
