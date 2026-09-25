// @vitest-environment happy-dom
/**
 * Regression: the passage must follow the typist.
 *
 * The typing viewport is a fixed-height, overflow-hidden box that is scrolled
 * programmatically. The active character used to drift out of view on longer
 * passages (the 300 s certificate test): the scroll target was computed from
 * the character's *on-screen* offset and then used as an absolute scrollTop,
 * so every scroll undid part of the previous one and the viewport settled
 * about halfway to where it needed to be.
 *
 * happy-dom has no layout engine, so these tests install a deterministic
 * monospace layout (fixed line height, fixed characters per line) that
 * honours the viewport's scrollTop, then assert on real DOM state: the
 * viewport's scrollTop and whether the active character's rect lies inside
 * the viewport's rect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TypingArea } from "@/features/typing/components/TypingArea";
import { TypingTest } from "@/features/typing/components/TypingTest";
import { nextActiveLineScrollTop } from "@/features/typing/lib/activeLineScroll";
import type { ErrorMap } from "@/types/typing";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// ─── Fake layout ─────────────────────────────────────────────────────────────

const LINE_HEIGHT = 40;
const CHAR_WIDTH = 10;
const CHARS_PER_LINE = 40;
const VIEWPORT = { top: 100, left: 50, width: CHARS_PER_LINE * CHAR_WIDTH };
const PADDING = 24;
let viewportHeight = 160; // 4 lines

const VIEWPORT_SELECTOR = '[data-testid="typing-viewport"]';

function charSpans(viewport: Element): HTMLElement[] {
  return Array.from(viewport.querySelectorAll("span"));
}

function rect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function installLayout() {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement
  ) {
    if (this.matches(VIEWPORT_SELECTOR)) {
      return rect(VIEWPORT.top, VIEWPORT.left, VIEWPORT.width, viewportHeight);
    }
    if (this.getAttribute("role") === "textbox") {
      return rect(
        VIEWPORT.top - PADDING,
        VIEWPORT.left - PADDING,
        VIEWPORT.width + 2 * PADDING,
        viewportHeight + 2 * PADDING
      );
    }
    const viewport = this.closest(VIEWPORT_SELECTOR);
    if (viewport && this.tagName === "SPAN") {
      const index = charSpans(viewport).indexOf(this);
      const line = Math.floor(index / CHARS_PER_LINE);
      const col = index % CHARS_PER_LINE;
      return rect(
        VIEWPORT.top + line * LINE_HEIGHT - viewport.scrollTop,
        VIEWPORT.left + col * CHAR_WIDTH - viewport.scrollLeft,
        CHAR_WIDTH,
        LINE_HEIGHT
      );
    }
    return original.call(this);
  });

  // Scroll metrics follow from the same layout.
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    return this.matches(VIEWPORT_SELECTOR) ? viewportHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    if (!this.matches(VIEWPORT_SELECTOR)) return 0;
    const lines = Math.ceil(charSpans(this).length / CHARS_PER_LINE);
    return lines * LINE_HEIGHT + 80; // + the content's bottom padding
  });
}

/** Resolves smooth scrolls immediately so assertions see the final offset. */
function stubInstantScroll() {
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(function (
    this: HTMLElement,
    ...args: unknown[]
  ) {
    const options = (typeof args[0] === "object" ? args[0] : { top: args[1] }) as {
      top?: number;
    };
    if (options.top !== undefined) this.scrollTop = options.top;
  });
}

function getViewport(): HTMLElement {
  const viewport = document.querySelector<HTMLElement>(VIEWPORT_SELECTOR);
  if (!viewport) throw new Error("typing viewport not rendered");
  return viewport;
}

function activeSpan(index: number): HTMLElement {
  const span = charSpans(getViewport())[index];
  if (!span) throw new Error(`no span at ${index}`);
  return span;
}

/** The whole character box lies inside the viewport's visible box. */
function isVisible(index: number): boolean {
  const vp = getViewport().getBoundingClientRect();
  const r = activeSpan(index).getBoundingClientRect();
  return r.top >= vp.top && r.bottom <= vp.bottom;
}

function lineOf(index: number) {
  return Math.floor(index / CHARS_PER_LINE);
}

function caretOffset(): { x: number; y: number } {
  const caret = getViewport().querySelector<HTMLElement>(".bg-accent");
  const m = caret?.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
  if (!m) throw new Error(`caret not positioned: ${caret?.style.transform}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

const passage = (chars: number) =>
  Array.from({ length: chars }, (_, i) => "abcdefghij"[i % 10]).join("");

function renderArea(chars: string[], currentIndex: number, errorMap: ErrorMap = {}) {
  const props = {
    chars,
    currentIndex,
    errorMap,
    status: "active" as const,
    onKey: () => {},
    onBackspace: () => {},
  };
  const view = render(createElement(TypingArea, props));
  return {
    ...view,
    moveTo: (index: number, nextErrorMap: ErrorMap = errorMap) =>
      view.rerender(
        createElement(TypingArea, {
          ...props,
          currentIndex: index,
          errorMap: nextErrorMap,
        })
      ),
  };
}

beforeEach(() => {
  viewportHeight = 160;
  installLayout();
  stubInstantScroll();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  push.mockReset();
});

// ─── Scroll policy (pure) ─────────────────────────────────────────────────────

describe("nextActiveLineScrollTop", () => {
  const base = { lineHeight: 40, viewportHeight: 160, maxScrollTop: 10_000 };

  it("does not scroll while the active line has a line of context on both sides", () => {
    expect(nextActiveLineScrollTop({ ...base, lineTop: 40, scrollTop: 0 })).toBeNull();
    expect(nextActiveLineScrollTop({ ...base, lineTop: 80, scrollTop: 0 })).toBeNull();
  });

  it("does not scroll on the first line", () => {
    expect(nextActiveLineScrollTop({ ...base, lineTop: 0, scrollTop: 0 })).toBeNull();
  });

  it("brings the active line back to the second row when it reaches the last row", () => {
    expect(nextActiveLineScrollTop({ ...base, lineTop: 120, scrollTop: 0 })).toBe(80);
  });

  it("scrolls up when the active line moves above the context band", () => {
    expect(nextActiveLineScrollTop({ ...base, lineTop: 80, scrollTop: 80 })).toBe(40);
  });

  it("never scrolls past the end of the content", () => {
    expect(
      nextActiveLineScrollTop({ ...base, lineTop: 400, maxScrollTop: 300, scrollTop: 0 })
    ).toBe(300);
    expect(
      nextActiveLineScrollTop({
        ...base,
        lineTop: 400,
        maxScrollTop: 300,
        scrollTop: 300,
      })
    ).toBeNull();
  });

  it("keeps the active line itself visible on a viewport shorter than the context", () => {
    const tiny = { lineHeight: 40, viewportHeight: 50, maxScrollTop: 10_000 };
    const target = nextActiveLineScrollTop({ ...tiny, lineTop: 200, scrollTop: 0 });
    expect(target).not.toBeNull();
    expect(200).toBeGreaterThanOrEqual(target!);
    expect(240).toBeLessThanOrEqual(target! + 50);
  });
});

// ─── TypingArea viewport ─────────────────────────────────────────────────────

describe("TypingArea — the active position stays visible", () => {
  it("starts at the top with the first character visible and the caret on it", () => {
    renderArea(passage(1000).split(""), 0);
    expect(getViewport().scrollTop).toBe(0);
    expect(isVisible(0)).toBe(true);
    expect(caretOffset()).toEqual({ x: 0, y: 0 });
  });

  it("scrolls when typing wraps onto the last visible line, keeping it visible with context", () => {
    const { moveTo } = renderArea(passage(1000).split(""), 0);

    const lastVisibleLine = 3 * CHARS_PER_LINE; // line 3 of 0..3
    moveTo(lastVisibleLine);

    expect(getViewport().scrollTop).toBe(2 * LINE_HEIGHT);
    expect(isVisible(lastVisibleLine)).toBe(true);
    // One typed line above, one upcoming line below, both visible.
    expect(isVisible(lastVisibleLine - CHARS_PER_LINE)).toBe(true);
    expect(isVisible(lastVisibleLine + CHARS_PER_LINE)).toBe(true);
  });

  it("does not scroll while the active position is already visible", () => {
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    const { moveTo } = renderArea(passage(1000).split(""), 0);

    for (let i = 1; i < 3 * CHARS_PER_LINE; i++) moveTo(i);
    expect(getViewport().scrollTop).toBe(0);
    expect(scrollTo).not.toHaveBeenCalled();

    // After a scroll, typing along the (now second) line does not scroll again.
    moveTo(3 * CHARS_PER_LINE);
    const after = getViewport().scrollTop;
    const callsAfterScroll = scrollTo.mock.calls.length;
    for (let i = 3 * CHARS_PER_LINE + 1; i < 4 * CHARS_PER_LINE; i++) moveTo(i);
    expect(getViewport().scrollTop).toBe(after);
    expect(scrollTo).toHaveBeenCalledTimes(callsAfterScroll);
  });

  it("follows a long passage to the end, across every line wrap", () => {
    const chars = passage(1000).split(""); // 25 lines, like a certificate passage
    const { moveTo } = renderArea(chars, 0);

    // Every line's first, second, middle, second-to-last and last character:
    // each wrap is crossed exactly as a typist crosses it.
    const positions: number[] = [];
    for (let line = 0; line * CHARS_PER_LINE < chars.length; line++) {
      for (const col of [
        0,
        1,
        CHARS_PER_LINE / 2,
        CHARS_PER_LINE - 2,
        CHARS_PER_LINE - 1,
      ]) {
        const i = line * CHARS_PER_LINE + col;
        if (i > 0 && i < chars.length) positions.push(i);
      }
    }

    let previousTop = 0;
    let scrolls = 0;
    for (const i of positions) {
      moveTo(i);
      const top = getViewport().scrollTop;
      expect(isVisible(i), `char ${i} (line ${lineOf(i)}) visible`).toBe(true);
      expect(top).toBeGreaterThanOrEqual(previousTop);
      // The caret is drawn on the active character, in content coordinates.
      expect(caretOffset()).toEqual({
        x: (i % CHARS_PER_LINE) * CHAR_WIDTH,
        y: lineOf(i) * LINE_HEIGHT,
      });
      if (top !== previousTop) scrolls++;
      previousTop = top;
    }
    // The last line is on screen with the typed line above it, and the
    // viewport moved in steps of lines (every other line), not per keystroke.
    const last = chars.length - 1;
    expect(isVisible(last)).toBe(true);
    expect(isVisible(last - CHARS_PER_LINE)).toBe(true);
    expect(scrolls).toBeGreaterThanOrEqual(10);
    expect(scrolls).toBeLessThanOrEqual(12);
  });

  it("scrolls back up when backspacing onto an earlier line", () => {
    const { moveTo } = renderArea(passage(1000).split(""), 0);
    moveTo(10 * CHARS_PER_LINE);
    const deep = getViewport().scrollTop;
    expect(deep).toBeGreaterThan(0);

    for (let i = 10 * CHARS_PER_LINE - 1; i >= 6 * CHARS_PER_LINE; i--) {
      moveTo(i);
      expect(isVisible(i)).toBe(true);
    }
    expect(getViewport().scrollTop).toBeLessThan(deep);
  });

  it("re-anchors the active position when the viewport is resized", () => {
    const observers: { cb: ResizeObserverCallback }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          observers.push({ cb });
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    const { moveTo } = renderArea(passage(1000).split(""), 0);
    moveTo(5 * CHARS_PER_LINE);
    expect(isVisible(5 * CHARS_PER_LINE)).toBe(true);

    // The viewport shrinks to two lines (e.g. a small screen / zoom).
    viewportHeight = 80;
    const index = 5 * CHARS_PER_LINE + 10;
    moveTo(index);
    act(() => observers.forEach(({ cb }) => cb([], {} as ResizeObserver)));
    expect(isVisible(index)).toBe(true);
  });
});

describe("TypingArea — character states are unchanged", () => {
  it("marks correct, incorrect, current and upcoming characters as before", () => {
    const errorMap: ErrorMap = { 1: { expected: "b", typed: "x", corrected: false } };
    renderArea(passage(100).split(""), 3, errorMap);

    expect(activeSpan(0).className).toContain("text-emerald-500");
    expect(activeSpan(1).className).toContain("text-danger");
    expect(activeSpan(1).className).toContain("border-danger");
    expect(activeSpan(3).className).toContain("font-black");
    expect(activeSpan(4).className).toContain("text-muted");
  });

  it("renders a fixed (corrected, then retyped correctly) character as correct", () => {
    // The engine clears the error entry when the position is retyped correctly.
    renderArea(passage(100).split(""), 3, {});
    expect(activeSpan(1).className).toContain("text-emerald-500");
  });

  it("keeps spaces as real, visible characters", () => {
    renderArea("ab cd".split(""), 2);
    expect(activeSpan(2).textContent).toBe(" ");
    expect(activeSpan(2).className).toContain("font-black");
  });
});

// ─── Full typing flow (certificate configuration) ────────────────────────────

describe("TypingTest — 300 s certificate test", () => {
  const CERT_PASSAGE = passage(960);

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
          sessionId: "sess_cert",
          integrityToken: "cert-integrity-token",
          passage: { id: "cert-001", content: CERT_PASSAGE },
        });
      }
      if (url === "/api/session/start") return json({ ok: true });
      if (url === "/api/result") return json({ shareUrl: "/result/share_cert" });
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const renderCertificateTest = () =>
    render(
      createElement(TypingTest, {
        mode: "timed",
        language: "english",
        duration: 300,
        trustTier: "CERTIFICATE",
        hideConfig: true,
      })
    );

  it("scrolls the passage as the typist moves down it", async () => {
    stubApi();
    renderCertificateTest();
    const textbox = await screen.findByRole("textbox");

    const typed = 8 * CHARS_PER_LINE + 5;
    for (let i = 0; i < typed; i++) {
      fireEvent.keyDown(textbox, { key: CERT_PASSAGE[i] });
    }

    await waitFor(() => {
      expect(getViewport().scrollTop).toBeGreaterThan(0);
      expect(isVisible(typed)).toBe(true);
      expect(activeSpan(typed).className).toContain("font-black");
    });
  });

  it("still submits exactly once on timer expiry, then navigates", async () => {
    const fetchMock = stubApi();
    renderCertificateTest();
    const textbox = await screen.findByRole("textbox");

    vi.useFakeTimers({
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    const typed = 6 * CHARS_PER_LINE;
    for (let i = 0; i < typed; i++) {
      fireEvent.keyDown(textbox, { key: CERT_PASSAGE[i] });
    }
    await act(async () => {
      vi.advanceTimersByTime(100); // a few frames: state flushes, viewport follows
    });
    expect(getViewport().scrollTop).toBeGreaterThan(0);
    expect(isVisible(typed)).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(301_000);
    });
    vi.useRealTimers();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/result/share_cert"));
    const resultCalls = () =>
      fetchMock.mock.calls.filter(([input]) => String(input) === "/api/result");
    expect(resultCalls()).toHaveLength(1);
    const body = JSON.parse(String(resultCalls()[0]?.[1]?.body));
    expect(body.eventTrace.events).toHaveLength(typed);

    await new Promise((r) => setTimeout(r, 50));
    expect(resultCalls()).toHaveLength(1);
  });

  it("completes by typing the whole passage and submits exactly once", async () => {
    const fetchMock = stubApi();
    render(
      createElement(TypingTest, {
        mode: "timed",
        language: "english",
        duration: 60,
        hideConfig: true,
      })
    );
    const textbox = await screen.findByRole("textbox");
    for (const ch of CERT_PASSAGE) fireEvent.keyDown(textbox, { key: ch });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/result/share_cert"));
    const calls = fetchMock.mock.calls.filter(
      ([input]) => String(input) === "/api/result"
    );
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(body.metrics).toMatchObject({
      correctChars: CERT_PASSAGE.length,
      incorrectChars: 0,
    });
  });
});
