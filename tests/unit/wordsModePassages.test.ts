// @vitest-environment happy-dom
/**
 * Every words-test length reaches its target.
 *
 * Regression: a words test types the first `wordCount` words of its passage
 * (limitToWords), but session creation served any NORMAL passage, and those
 * were 24–48 words long. 50-, 100- and 200-word tests ended early, below the
 * target the typing stats showed. The stored word counts were also overstated
 * (50 for a 48-word passage), so they could not be relied on to filter.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { englishPassages } from "@/features/typing/lib/passages";
import { countWords, limitToWords } from "@/features/typing/lib/wordLimit";
import { useTypingEngine } from "@/features/typing/hooks/useTypingEngine";
import { reconstructFinalBuffer } from "@/features/typing/lib/reconstruct";
import { CreateSessionSchema } from "@/schemas/session.schema";
import { WORD_COUNTS } from "@/lib/constants";
import type { EventTrace } from "@/schemas/result.schema";
import type { TypingEngineState } from "@/types/typing";

/** Passages a words test of `n` words may be served (createSession's rule). */
const eligibleFor = (n: number) =>
  englishPassages.filter((p) => countWords(p.content) >= n);

/** Distinct passages each words-test length can be served, at least. */
const MIN_POOL = 3;

afterEach(() => {
  vi.useRealTimers();
});

describe("countWords", () => {
  it("counts space-separated words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("one")).toBe(1);
    expect(countWords("one two three")).toBe(3);
    expect(countWords("Hello, world. It works.")).toBe(4);
  });

  it("agrees with where limitToWords cuts", () => {
    const passage = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    for (let n = 1; n <= 30; n++) {
      expect(countWords(limitToWords(passage, n))).toBe(n);
    }
    // Asking for more words than the passage has returns all of it.
    expect(limitToWords(passage, 31)).toBe(passage);
    expect(countWords(limitToWords(passage, 31))).toBe(30);
  });
});

describe("English passages", () => {
  it.each(englishPassages.map((p) => [p.id, p] as const))(
    "%s is plain typeable ASCII with an accurate word count",
    (_id, passage) => {
      // Printable ASCII only, single spaces, no leading/trailing space.
      expect(passage.content).toMatch(/^[\x21-\x7e]+( [\x21-\x7e]+)*$/);
      expect(passage.wordCount).toBe(countWords(passage.content));
    }
  );
});

describe.each(WORD_COUNTS.map((n) => [n] as const))("a %i-word test", (n) => {
  it(`can be served at least ${MIN_POOL} different passages`, () => {
    expect(eligibleFor(n).length).toBeGreaterThanOrEqual(MIN_POOL);
  });

  it("is cut to exactly its target from every passage it can be served", () => {
    for (const passage of eligibleFor(n)) {
      const typed = limitToWords(passage.content, n);
      expect(countWords(typed)).toBe(n);
      expect(passage.content.startsWith(typed)).toBe(true);
      expect(typed.endsWith(" ")).toBe(false);
    }
  });

  it("completes on the target's last character and reconstructs against the full passage", () => {
    // The shortest eligible passage is the binding case.
    const passage = [...eligibleFor(n)].sort(
      (a, b) => countWords(a.content) - countWords(b.content)
    )[0]!;
    const target = limitToWords(passage.content, n);

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
    const { result } = renderHook(() =>
      useTypingEngine({
        passage: passage.content,
        mode: "words",
        language: "english",
        wordCount: n,
        onComplete,
      })
    );
    expect(result.current.chars.join("")).toBe(target);

    for (const ch of target) {
      expect(onComplete).not.toHaveBeenCalled();
      act(() => result.current.handleKey(ch));
      act(() => vi.advanceTimersByTime(50));
    }

    expect(onComplete).toHaveBeenCalledTimes(1);
    const final = onComplete.mock.calls[0]![0];
    expect(final.currentIndex).toBe(target.length);
    expect(final.correctCharacters).toBe(target.length);

    const rec = reconstructFinalBuffer(passage.content, final.eventTrace as EventTrace);
    expect(rec.isValidTrace).toBe(true);
    expect(rec.correctChars).toBe(target.length);
    expect(rec.totalChars).toBe(target.length);
  }, 30_000);
});

describe("CreateSessionSchema word counts", () => {
  const words = (wordCount: number) =>
    CreateSessionSchema.safeParse({ mode: "words", language: "english", wordCount });

  it.each(WORD_COUNTS.map((n) => [n] as const))("accepts %i words", (n) => {
    expect(words(n).success).toBe(true);
  });

  it.each([[1], [30], [150], [300], [5000]])("rejects %i words", (n) => {
    const parsed = words(n);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join("."))).toContain("wordCount");
  });

  it("does not restrict other modes", () => {
    expect(
      CreateSessionSchema.safeParse({ mode: "timed", language: "english", duration: 60 })
        .success
    ).toBe(true);
    expect(
      CreateSessionSchema.safeParse({ mode: "practice", language: "english" }).success
    ).toBe(true);
  });
});

describe("migration 20260930000000_words_mode_passages", () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      "../../prisma/migrations/20260930000000_words_mode_passages/migration.sql"
    ),
    "utf8"
  );
  const longPassages = englishPassages.filter((p) => p.id.startsWith("en-long-"));

  it("inserts exactly the long passages in passages.ts", () => {
    expect(longPassages.length).toBeGreaterThanOrEqual(MIN_POOL);
    const rows = longPassages
      .map(
        (p) =>
          `    ('${p.content.replace(/'/g, "''")}', '${p.category}', ${p.wordCount}, ${p.content.length})`
      )
      .join(",\n");
    expect(sql).toContain(`FROM (VALUES\n${rows}\n) AS v(`);
    expect(sql).toContain(
      `WHERE NOT EXISTS (SELECT 1 FROM "passages" p WHERE p."content" = v."content")`
    );
  });

  it("recounts NORMAL English word counts the way countWords does, deleting nothing", () => {
    expect(sql).toContain(
      `char_length("content") - char_length(replace("content", ' ', '')) + 1`
    );
    expect(sql).toContain(`WHERE "mode" = 'NORMAL' AND "language" = 'ENGLISH'`);
    const statementsOnly = sql.replace(/^ {4}\('.*$/gm, ""); // minus the passage text
    expect(statementsOnly).not.toMatch(/\bDELETE\b/i);
  });
});
