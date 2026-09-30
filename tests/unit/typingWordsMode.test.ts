// @vitest-environment happy-dom
/**
 * Word-count tests end on the last character of the final word.
 *
 * Regression: a words test only finished once the typist had typed the space
 * after the final word AND the first character of the next one, and that
 * extra keystroke was scored. The whole passage was shown too, so nothing
 * marked where the test ended. The engine now types only the first
 * `wordCount` words of the passage.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor, screen, fireEvent } from "@testing-library/react";
import { useTypingEngine } from "@/features/typing/hooks/useTypingEngine";
import { limitToWords } from "@/features/typing/lib/wordLimit";
import { reconstructFinalBuffer } from "@/features/typing/lib/reconstruct";
import { renderReadyTypingTest } from "../setup/typingTestHarness";
import type { EventTrace } from "@/schemas/result.schema";
import type { TypingEngineState } from "@/types/typing";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  push.mockReset();
});

// 15 words; a 10-word test ends after "w9".
const PASSAGE = Array.from({ length: 15 }, (_, i) => `w${i}`).join(" ");
const TEN_WORDS = "w0 w1 w2 w3 w4 w5 w6 w7 w8 w9";

describe("limitToWords", () => {
  it("keeps the first N words, ending on the last character of the final word", () => {
    expect(limitToWords(PASSAGE, 10)).toBe(TEN_WORDS);
    expect(limitToWords("one two three", 1)).toBe("one");
  });

  it("keeps a passage that has no more words than asked for", () => {
    expect(limitToWords("one two", 2)).toBe("one two");
    expect(limitToWords("one two", 5)).toBe("one two");
  });

  it("does not limit for a non-positive or non-finite count", () => {
    expect(limitToWords("one two", 0)).toBe("one two");
    expect(limitToWords("one two", Number.NaN)).toBe("one two");
  });

  it("displays current word ordinal (1-based) during the test", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            sessionId: "sess_words",
            integrityToken: "words-token",
            passage: { id: "p-words", content: TEN_WORDS },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );

    const textbox = await renderReadyTypingTest({ mode: "words", wordCount: 10 });

    // Press a key to activate the test and show stats
    act(() => {
      fireEvent.keyDown(textbox, { key: "w" });
    });
    await waitFor(() => expect(screen.getByText("1/10")).toBeDefined());

    // Complete the first word
    act(() => {
      fireEvent.keyDown(textbox, { key: "0" });
    });
    act(() => {
      fireEvent.keyDown(textbox, { key: " " });
    });
    await waitFor(() => expect(screen.getByText("2/10")).toBeDefined());

    // Type all the way to the last word
    for (const key of TEN_WORDS.slice(3, -1)) {
      act(() => {
        fireEvent.keyDown(textbox, { key });
      });
    }
    await waitFor(() => expect(screen.getByText("10/10")).toBeDefined());
  });
});

function renderWordsEngine() {
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
      passage: PASSAGE,
      mode: "words",
      language: "english",
      wordCount: 10,
      onComplete,
    })
  );
  const type = (keys: string) => {
    for (const k of keys) {
      act(() => hook.result.current.handleKey(k));
      act(() => vi.advanceTimersByTime(100));
    }
  };
  return { hook, type, onComplete };
}

describe("useTypingEngine — words mode", () => {
  it("types only the configured number of words", () => {
    const { hook } = renderWordsEngine();
    expect(hook.result.current.chars.join("")).toBe(TEN_WORDS);
  });

  it("completes on the final word's last character, not a keystroke later", () => {
    const { type, onComplete } = renderWordsEngine();
    type(TEN_WORDS.slice(0, -1));
    expect(onComplete).not.toHaveBeenCalled();

    type("9");
    expect(onComplete).toHaveBeenCalledTimes(1);
    const final = onComplete.mock.calls[0]![0];
    expect(final.correctCharacters).toBe(TEN_WORDS.length);
    expect(final.totalCharacters).toBe(TEN_WORDS.length);
    expect(final.accuracy).toBe(1);

    const events = final.eventTrace?.events ?? [];
    expect(events).toHaveLength(TEN_WORDS.length);
    expect(Math.max(...events.map((e) => e[2]))).toBe(TEN_WORDS.length - 1);
  });

  it("agrees with the server's reconstruction against the full passage", () => {
    const { type, hook, onComplete } = renderWordsEngine();
    type("w0 x1"); // a typo left in, then a correct character deleted and retyped
    act(() => hook.result.current.handleBackspace());
    type(`1${TEN_WORDS.slice(5)}`);
    expect(onComplete).toHaveBeenCalledTimes(1);
    const final = onComplete.mock.calls[0]![0];

    const rec = reconstructFinalBuffer(PASSAGE, final.eventTrace as EventTrace);
    expect(rec.isValidTrace).toBe(true);
    expect({
      correctChars: final.correctCharacters,
      incorrectChars: final.incorrectCharacters,
      totalChars: final.totalCharacters,
      correctedErrors: final.correctedErrors,
      uncorrectedErrors: final.uncorrectedErrors,
    }).toEqual({
      correctChars: rec.correctChars,
      incorrectChars: rec.incorrectChars,
      totalChars: rec.totalChars,
      correctedErrors: rec.correctedErrors,
      uncorrectedErrors: rec.uncorrectedErrors,
    });
  });
});

describe("TypingTest — words mode", () => {
  it("shows only the words the test asks for", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) !== "/api/session/create") throw new Error("unexpected");
        return new Response(
          JSON.stringify({
            sessionId: "sess_words",
            integrityToken: "words-token",
            passage: { id: "p-words", content: PASSAGE },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
    );

    const textbox = await renderReadyTypingTest({ mode: "words", wordCount: 10 });
    await waitFor(() => expect(textbox.textContent).toContain(TEN_WORDS));
    expect(textbox.textContent).not.toContain("w10");
  });
});
