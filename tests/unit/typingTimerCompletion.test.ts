// @vitest-environment happy-dom
/**
 * Regression: timed tests that end by timer expiry must submit the result.
 *
 * The engine's rAF `tick` loop is memoized per (mode, duration), so it used to
 * hold the completion handler from the first render — created before the
 * session existed. Timer expiry then called a submitResult that saw
 * `session === null` and silently returned: no POST /api/result, no
 * navigation, the page stuck on "Test complete.". Only finishing by typing
 * the whole passage (which goes through the fresh handleKey path) worked.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useTypingEngine } from "@/features/typing/hooks/useTypingEngine";
import { TypingTest } from "@/features/typing/components/TypingTest";
import type { TypingEngineState } from "@/types/typing";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// Fake the clock the engine reads (Date.now) and the loop it runs on (rAF).
const FAKE_TIMERS = {
  toFake: [
    "Date",
    "setTimeout",
    "clearTimeout",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const,
};
const DURATION_S = 15;
const PAST_EXPIRY_MS = (DURATION_S + 1) * 1000;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("useTypingEngine — timer expiry", () => {
  it("calls the latest onComplete, not the one from the first render", () => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMERS.toFake] });
    const firstRender = vi.fn<(s: TypingEngineState) => void>();
    const latest = vi.fn<(s: TypingEngineState) => void>();

    const { result, rerender } = renderHook(
      ({ onComplete }) =>
        useTypingEngine({
          passage: "the quick brown fox",
          mode: "timed",
          language: "english",
          duration: DURATION_S,
          onComplete,
        }),
      { initialProps: { onComplete: firstRender } }
    );
    // Mirrors TypingTest: the handler changes once the session arrives.
    rerender({ onComplete: latest });

    act(() => result.current.handleKey("t"));
    act(() => vi.advanceTimersByTime(PAST_EXPIRY_MS));

    expect(firstRender).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(latest.mock.calls[0]?.[0]).toMatchObject({
      status: "completed",
      completed: true,
    });

    // The loop is stopped: more time passing must not complete again.
    act(() => vi.advanceTimersByTime(PAST_EXPIRY_MS));
    expect(latest).toHaveBeenCalledTimes(1);
  });
});

describe("TypingTest — timer expiry submits the result", () => {
  function stubApi() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url === "/api/session/create") {
        return json({
          sessionId: "sess_test",
          integrityToken: "test-integrity-token",
          passage: { id: "p1", content: "the quick brown fox jumps over the lazy dog" },
        });
      }
      if (url === "/api/session/start") return json({ ok: true });
      if (url === "/api/result") return json({ shareUrl: "/result/share_test" });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const resultCalls = (fetchMock: ReturnType<typeof stubApi>) =>
    fetchMock.mock.calls.filter(([input]) => String(input) === "/api/result");

  it("POSTs /api/result exactly once with the live session, then navigates", async () => {
    const fetchMock = stubApi();
    render(
      createElement(TypingTest, {
        mode: "timed",
        language: "english",
        duration: DURATION_S,
        trustTier: "CERTIFICATE",
        hideConfig: true,
      })
    );
    const textbox = await screen.findByRole("textbox");

    vi.useFakeTimers({ toFake: [...FAKE_TIMERS.toFake] });
    fireEvent.keyDown(textbox, { key: "t" });
    await act(async () => {
      vi.advanceTimersByTime(PAST_EXPIRY_MS);
    });
    vi.useRealTimers();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/result/share_test"));

    const calls = resultCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      sessionId: "sess_test",
      integrityToken: "test-integrity-token",
    });
    expect(body.eventTrace.events.length).toBeGreaterThan(0);
    expect(screen.queryByText(/Failed to save result|session is missing/)).toBeNull();

    // Nothing may re-submit afterwards.
    await new Promise((r) => setTimeout(r, 50));
    expect(resultCalls(fetchMock)).toHaveLength(1);
  });
});
