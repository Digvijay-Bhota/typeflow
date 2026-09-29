// @vitest-environment happy-dom
/**
 * Render budget for a running test.
 *
 * The engine keeps hot-path state in refs and publishes it to React from its
 * requestAnimationFrame loop. It used to publish on every frame (about 60
 * commits a second, each re-rendering every character span of the passage —
 * 3,750+ spans on a certificate test) whether or not anything had changed.
 * It now publishes on the frame after a keystroke and whenever the elapsed
 * whole second changes (the timer's resolution), so an idle-but-running test
 * costs about one commit a second and typing costs about one per keystroke.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { Profiler, createElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TypingTest } from "@/features/typing/components/TypingTest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"];
const PASSAGE = Array.from({ length: 150 }, (_, i) => WORDS[i % WORDS.length]).join(" ");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  push.mockReset();
});

function stubApi() {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/session/create") {
        return json({
          sessionId: "sess_render",
          integrityToken: "render-token",
          passage: { id: "p-render", content: PASSAGE },
        });
      }
      if (url === "/api/session/start") return json({ ok: true });
      if (url === "/api/result") return json({ shareUrl: "/result/share_render" });
      throw new Error(`unexpected fetch ${url}`);
    })
  );
}

const FRAME_MS = 16;

/**
 * Advances the fake clock one animation frame at a time, each in its own act()
 * so React commits per frame as a browser would (a single act() around many
 * frames would batch all their updates into one commit and hide the cost).
 */
async function runFrames(ms: number) {
  for (let t = 0; t < ms; t += FRAME_MS) {
    await act(async () => {
      vi.advanceTimersByTime(Math.min(FRAME_MS, ms - t));
    });
  }
}

describe("TypingTest — render budget while a test runs", () => {
  it("commits about once per keystroke while typing and once a second while idle", async () => {
    stubApi();
    let commits = 0;
    const element = createElement(
      Profiler,
      { id: "typing-test", onRender: () => void commits++ },
      createElement(TypingTest, {
        mode: "timed",
        language: "english",
        duration: 60,
        hideConfig: true,
      })
    );
    const { rerender } = render(element);
    const textbox = await screen.findByRole("textbox");
    rerender(element); // flush the passage-change reset (see typingTestHarness)

    vi.useFakeTimers({
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });

    // 5 s of typing at 100 WPM: one keystroke every 120 ms.
    const KEYSTROKES = 42;
    commits = 0;
    for (let i = 0; i < KEYSTROKES; i++) {
      fireEvent.keyDown(textbox, { key: PASSAGE[i] });
      await runFrames(120);
    }
    const typingCommits = commits;

    // 5 s with the test running but no keys pressed.
    commits = 0;
    await runFrames(5_000);
    const idleCommits = commits;

    // Every keystroke is still shown: the caret sits on the next character.
    const active = document.querySelectorAll('[data-testid="typing-viewport"] span');
    expect(active[KEYSTROKES]?.className).toContain("font-black");
    // The timer kept counting while idle: 60 s − ~10.04 s elapsed.
    expect(screen.getByText("0:50")).toBeTruthy();

    // One commit per keystroke plus one per elapsed second; previously one
    // per 16 ms frame (~315 in each phase).
    expect(typingCommits).toBeGreaterThanOrEqual(KEYSTROKES);
    expect(typingCommits).toBeLessThanOrEqual(KEYSTROKES + 7);
    expect(idleCommits).toBeGreaterThanOrEqual(4);
    expect(idleCommits).toBeLessThanOrEqual(6);
  }, 30_000);
});
