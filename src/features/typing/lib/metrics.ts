/**
 * TypeFlow Typing Metrics
 *
 * All metric calculation functions are pure, deterministic, and testable.
 * Every formula is documented with its definition and calculation method.
 *
 * ─── WPM Standard ────────────────────────────────────────────────────────────
 * The typing industry standard: 1 word = 5 characters.
 * This normalizes for varying word lengths in passages.
 * Source: standard used by Monkeytype, Typeracer, Keybr, and most WPM tests.
 */

import { CHARS_PER_WORD } from "@/lib/constants";

// ─── Basic Metrics ────────────────────────────────────────────────────────────

/**
 * Convert elapsed milliseconds to minutes (float).
 */
function msToMinutes(elapsedMs: number): number {
  return elapsedMs / 60_000;
}

/**
 * WPM — Words Per Minute (standard/gross WPM)
 *
 * Formula: correctCharacters / CHARS_PER_WORD / elapsedMinutes
 *
 * Only counts correctly typed characters.
 * A "word" is defined as 5 characters (industry standard).
 *
 * @param correctChars Number of correctly typed characters
 * @param elapsedMs Elapsed time in milliseconds
 * @returns WPM rounded to 1 decimal place
 */
export function calculateWpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const minutes = msToMinutes(elapsedMs);
  return Math.round((correctChars / CHARS_PER_WORD / minutes) * 10) / 10;
}

/**
 * Raw WPM — Words Per Minute (gross, including errors)
 *
 * Formula: totalCharacters / CHARS_PER_WORD / elapsedMinutes
 *
 * Counts ALL keystrokes (correct + incorrect).
 * Represents the user's raw input speed before error adjustment.
 *
 * @param totalChars Total characters typed (correct + incorrect)
 * @param elapsedMs Elapsed time in milliseconds
 * @returns Raw WPM rounded to 1 decimal place
 */
export function calculateRawWpm(totalChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const minutes = msToMinutes(elapsedMs);
  return Math.round((totalChars / CHARS_PER_WORD / minutes) * 10) / 10;
}

/**
 * Net WPM — Words Per Minute (net, penalizing uncorrected errors)
 *
 * Formula: WPM - (uncorrectedErrors / elapsedMinutes)
 *
 * Each uncorrected error subtracts from WPM proportional to time.
 * Net WPM is the most meaningful measure of effective output.
 * Result is clamped to 0 (cannot be negative).
 *
 * @param wpm Standard WPM
 * @param uncorrectedErrors Errors not fixed by backspace
 * @param elapsedMs Elapsed time in milliseconds
 * @returns Net WPM (clamped ≥ 0)
 */
export function calculateNetWpm(
  wpm: number,
  uncorrectedErrors: number,
  elapsedMs: number
): number {
  if (elapsedMs <= 0) return 0;
  const minutes = msToMinutes(elapsedMs);
  const penalty = uncorrectedErrors / minutes;
  return Math.max(0, Math.round((wpm - penalty) * 10) / 10);
}

/**
 * Accuracy — ratio of correct characters to total typed characters
 *
 * Formula: correctCharacters / totalCharacters
 *
 * Returns a ratio 0–1. 1.0 = perfect accuracy.
 * Returns 1.0 if nothing has been typed yet.
 *
 * @param correctChars Number of correctly typed characters
 * @param totalChars Total characters typed
 * @returns Accuracy ratio 0–1
 */
export function calculateAccuracy(correctChars: number, totalChars: number): number {
  if (totalChars === 0) return 1;
  return Math.min(1, correctChars / totalChars);
}

/**
 * Error Rate — ratio of incorrect characters to total typed characters
 *
 * Formula: incorrectCharacters / totalCharacters
 *
 * Inverse of accuracy (errorRate = 1 - accuracy, approximately).
 *
 * @param incorrectChars Number of incorrectly typed characters
 * @param totalChars Total characters typed
 * @returns Error rate ratio 0–1
 */
export function calculateErrorRate(incorrectChars: number, totalChars: number): number {
  if (totalChars === 0) return 0;
  return Math.min(1, incorrectChars / totalChars);
}

/**
 * Characters Per Minute (CPM)
 *
 * Formula: correctCharacters / elapsedMinutes
 *
 * Used in some international standards (especially government exams in India).
 *
 * @param correctChars Number of correctly typed characters
 * @param elapsedMs Elapsed time in milliseconds
 * @returns CPM rounded to nearest integer
 */
export function calculateCpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const minutes = msToMinutes(elapsedMs);
  return Math.round(correctChars / minutes);
}

/**
 * Keystrokes Per Minute (KSPM)
 *
 * Formula: totalKeystrokes / elapsedMinutes
 *
 * Counts every key pressed including backspace.
 * Useful for keyboard heatmap analysis.
 *
 * @param totalKeystrokes Total keystrokes including backspace
 * @param elapsedMs Elapsed time in milliseconds
 * @returns KSPM rounded to nearest integer
 */
export function calculateKspm(totalKeystrokes: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const minutes = msToMinutes(elapsedMs);
  return Math.round(totalKeystrokes / minutes);
}

// ─── Consistency ──────────────────────────────────────────────────────────────

/**
 * Consistency — measures stability of typing speed over intervals
 *
 * Formula:
 *   1. Split the test into N intervals (e.g., every 5 seconds)
 *   2. Calculate WPM for each interval
 *   3. Compute coefficient of variation (CV): stdDev(wpms) / mean(wpms)
 *   4. Consistency = max(0, 1 - CV)
 *
 * 1.0 = perfectly consistent speed throughout the test.
 * 0.0 = extremely erratic speed.
 *
 * Requires at least 3 data points for meaningful result.
 *
 * @param intervalWpms Array of WPM values for each time interval
 * @returns Consistency score 0–1, or null if insufficient data
 */
export function calculateConsistency(intervalWpms: number[]): number | null {
  if (intervalWpms.length < 3) return null;

  const validWpms = intervalWpms.filter((w) => w > 0);
  if (validWpms.length < 3) return null;

  const mean = validWpms.reduce((a, b) => a + b, 0) / validWpms.length;
  if (mean === 0) return null;

  const variance =
    validWpms.reduce((sum, wpm) => sum + Math.pow(wpm - mean, 2), 0) / validWpms.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean;

  return Math.max(0, Math.min(1, 1 - cv));
}

// ─── Error Analysis ───────────────────────────────────────────────────────────

/**
 * Rank keys by error count (descending).
 * Returns the N weakest keys.
 *
 * @param keyErrors Aggregated key error map
 * @param topN Number of weak keys to return
 */
export function getWeakKeys(
  keyErrors: Record<string, { count: number; corrected: number; uncorrected: number }>,
  topN = 10
): Array<{
  key: string;
  errorCount: number;
  correctedCount: number;
  uncorrectedCount: number;
}> {
  return Object.entries(keyErrors)
    .map(([key, data]) => ({
      key,
      errorCount: data.count,
      correctedCount: data.corrected,
      uncorrectedCount: data.uncorrected,
    }))
    .sort((a, b) => b.errorCount - a.errorCount)
    .slice(0, topN);
}

/**
 * Classify a character into a keyboard category.
 */
export type KeyCategory =
  | "alphabetic"
  | "numeric"
  | "symbol"
  | "punctuation"
  | "uppercase"
  | "whitespace"
  | "bracket"
  | "operator"
  | "other";

export function classifyKey(char: string): KeyCategory {
  if (char === " " || char === "\n" || char === "\t") return "whitespace";
  if (/^[a-z]$/.test(char)) return "alphabetic";
  if (/^[A-Z]$/.test(char)) return "uppercase";
  if (/^[0-9]$/.test(char)) return "numeric";
  if (/^[.,;:!?'"…]$/.test(char)) return "punctuation";
  if (/^[\[\]{}()<>]$/.test(char)) return "bracket";
  if (/^[+\-*/%=&|^~\\]$/.test(char)) return "operator";
  if (/^[`@#$_]$/.test(char)) return "symbol";
  return "other";
}

/**
 * Compute category-level error breakdown.
 */
export function analyzeErrorsByCategory(
  keyErrors: Record<string, { count: number }>
): Record<KeyCategory, number> {
  const result: Record<KeyCategory, number> = {
    alphabetic: 0,
    numeric: 0,
    symbol: 0,
    punctuation: 0,
    uppercase: 0,
    whitespace: 0,
    bracket: 0,
    operator: 0,
    other: 0,
  };

  for (const [key, data] of Object.entries(keyErrors)) {
    const category = classifyKey(key);
    result[category] = (result[category] ?? 0) + data.count;
  }

  return result;
}
