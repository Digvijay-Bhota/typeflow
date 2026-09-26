// @vitest-environment happy-dom
/**
 * Certificate passages must last the whole 300 s certificate test.
 *
 * The engine ends a test when its passage runs out, and the server marks a
 * CERTIFICATE result that ends before its duration INVALID (no passage-
 * completed exemption for high-trust tiers). The previous passages were
 * 908–962 characters, so anyone faster than ~38 WPM finished early and could
 * never be certified.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import { certificatePassages } from "@/features/typing/lib/passages";
import { useTypingEngine } from "@/features/typing/hooks/useTypingEngine";
import { evaluateCertificateEligibility } from "@/lib/certificateEligibility";
import {
  CERTIFICATE_MIN_ACCURACY,
  CERTIFICATE_MIN_DURATION,
  CERTIFICATE_MIN_PASSAGE_CHARS,
  CERTIFICATE_MIN_WPM,
  CERTIFICATE_PASSAGE_TARGET_WPM,
  CHARS_PER_WORD,
} from "@/lib/constants";
import type { TypingEngineState } from "@/types/typing";

/** Raw WPM at which `chars` characters last exactly `seconds`. */
const wpmThatLasts = (chars: number, seconds: number) =>
  chars / CHARS_PER_WORD / (seconds / 60);

afterEach(() => {
  vi.useRealTimers();
});

describe("certificate passage length", () => {
  it("derives the minimum length from the target speed and the app's WPM definition", () => {
    expect(CERTIFICATE_PASSAGE_TARGET_WPM).toBe(150);
    expect(CERTIFICATE_MIN_PASSAGE_CHARS).toBe(150 * 5 * 5);
    expect(wpmThatLasts(CERTIFICATE_MIN_PASSAGE_CHARS, CERTIFICATE_MIN_DURATION)).toBe(
      CERTIFICATE_PASSAGE_TARGET_WPM
    );
    // Far above the certification minimum, with room for fast typists.
    expect(CERTIFICATE_PASSAGE_TARGET_WPM).toBeGreaterThanOrEqual(
      CERTIFICATE_MIN_WPM * 4
    );
  });

  it.each(certificatePassages.map((p) => [p.id, p] as const))(
    "%s lasts the full test at the target speed",
    (_id, passage) => {
      expect(passage.content.length).toBeGreaterThanOrEqual(
        CERTIFICATE_MIN_PASSAGE_CHARS
      );
      expect(
        wpmThatLasts(passage.content.length, CERTIFICATE_MIN_DURATION)
      ).toBeGreaterThanOrEqual(CERTIFICATE_PASSAGE_TARGET_WPM);
    }
  );

  it.each(certificatePassages.map((p) => [p.id, p] as const))(
    "%s is plain typeable ASCII with an accurate word count",
    (_id, passage) => {
      // Printable ASCII only, single spaces, no leading/trailing space.
      expect(passage.content).toMatch(/^[\x21-\x7e]+( [\x21-\x7e]+)*$/);
      expect(passage.wordCount).toBe(passage.content.split(/\s+/).length);
    }
  );

  it("offers more than one certificate passage", () => {
    expect(certificatePassages.length).toBeGreaterThanOrEqual(2);
    expect(new Set(certificatePassages.map((p) => p.content)).size).toBe(
      certificatePassages.length
    );
  });
});

describe("migration 20260925000000_long_certificate_passages", () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      "../../prisma/migrations/20260925000000_long_certificate_passages/migration.sql"
    ),
    "utf8"
  );

  it("inserts exactly the passages in passages.ts", () => {
    const rows = certificatePassages
      .map(
        (p) =>
          `    ('${p.content.replace(/'/g, "''")}', ${p.wordCount}, ${p.content.length})`
      )
      .join(",\n");
    expect(sql).toContain(`FROM (VALUES\n${rows}\n) AS v(`);
    expect(sql).toContain(
      `WHERE NOT EXISTS (SELECT 1 FROM "passages" p WHERE p."content" = v."content")`
    );
  });

  it("retires certificate passages below the same minimum length", () => {
    expect(sql).toContain(
      `WHERE "mode" = 'CERTIFICATE' AND "isActive" = true AND char_length("content") < ${CERTIFICATE_MIN_PASSAGE_CHARS};`
    );
    // Retired, not deleted: past sessions reference them.
    const statementsOnly = sql.replace(/^ {4}\('.*$/gm, ""); // minus the passage text
    expect(statementsOnly).not.toMatch(/\bDELETE\b/i);
  });
});

describe("typing a certificate passage for the full 300 s", () => {
  /**
   * Types `passage` at a steady `wpm` (raw keystrokes) until the engine
   * completes, with the engine's own clock and rAF loop driven by fake timers.
   */
  function typeAt(passage: string, wpm: number) {
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
        passage,
        mode: "timed",
        language: "english",
        duration: CERTIFICATE_MIN_DURATION,
        onComplete,
      })
    );

    const keyIntervalMs = 60_000 / (wpm * CHARS_PER_WORD);
    let typed = 0;
    while (onComplete.mock.calls.length === 0 && typed < passage.length + 1) {
      const ch = passage[typed] ?? " ";
      act(() => result.current.handleKey(ch));
      typed++;
      act(() => vi.advanceTimersByTime(keyIntervalMs));
    }
    // Let the timer run out if typing has stopped short of it.
    act(() => vi.advanceTimersByTime((CERTIFICATE_MIN_DURATION + 1) * 1000));

    expect(onComplete).toHaveBeenCalledTimes(1);
    return onComplete.mock.calls[0]![0];
  }

  it("the old 962-character passage ran out early for a 60 WPM typist", () => {
    const final = typeAt("a".repeat(962), 60);
    expect(final.currentIndex).toBe(962);
    expect(final.elapsedMs).toBeLessThan(CERTIFICATE_MIN_DURATION * 1000);
  });

  it("a 120 WPM typist is still mid-passage when the 300 s timer ends the test", () => {
    // The shortest certificate passage is the binding case.
    const shortest = [...certificatePassages].sort(
      (a, b) => a.content.length - b.content.length
    )[0]!;
    const final = typeAt(shortest.content, 120);

    expect(final.elapsedMs).toBeGreaterThanOrEqual(CERTIFICATE_MIN_DURATION * 1000);
    expect(final.currentIndex).toBeLessThan(shortest.content.length);
    // 120 WPM × 5 chars × 5 min = 3,000 characters typed.
    expect(final.currentIndex).toBeGreaterThanOrEqual(2990);
    expect(final.currentIndex).toBeLessThanOrEqual(3001);
  }, 30_000);
});

describe("certificate eligibility rules are unchanged", () => {
  it("keeps the thresholds", () => {
    expect(CERTIFICATE_MIN_DURATION).toBe(300);
    expect(CERTIFICATE_MIN_WPM).toBe(30);
    expect(CERTIFICATE_MIN_ACCURACY).toBe(90);
  });

  const base = {
    netWpm: 30,
    accuracy: 0.9,
    duration: 300,
    integrityStatus: "VERIFIED",
    scoringSource: "SERVER_RECONSTRUCTED",
    trustTier: "CERTIFICATE",
    userId: "user-1",
  };

  it("accepts a result exactly at every threshold", () => {
    expect(evaluateCertificateEligibility(base).eligible).toBe(true);
  });

  it.each([
    ["net WPM below 30", { netWpm: 29.9 }],
    ["accuracy below 90%", { accuracy: 0.899 }],
    ["duration below 300 s", { duration: 299 }],
    ["not VERIFIED", { integrityStatus: "INVALID" }],
    ["client counts", { scoringSource: "CLIENT_COUNTS" }],
    ["not the CERTIFICATE tier", { trustTier: "FREE" }],
  ])("rejects %s", (_label, override) => {
    expect(evaluateCertificateEligibility({ ...base, ...override }).eligible).toBe(false);
  });
});
