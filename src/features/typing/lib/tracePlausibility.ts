/**
 * Trace plausibility: server-side timing checks for a keystroke trace.
 *
 * reconstructFinalBuffer() proves a trace is structurally valid (ordered
 * timestamps, consecutive indices, backspaces only at the end). It says
 * nothing about how keystrokes are spread over time. WPM is scored over the
 * whole test duration, so a trace with every keystroke packed into the first
 * few seconds scores like a slow, steady typist.
 *
 * This module adds pure, deterministic timing checks. It is NOT proof that a
 * human typed the input: a determined attacker can still forge a realistic
 * trace. It raises the cost of the cheap attacks. Server-timed checkpoints
 * (the server records when progress arrives) are the stronger defence.
 *
 * The default thresholds are deliberately generous first guesses. Run this in
 * log-only mode on real traffic and tune them before letting it change a
 * result. Also check how the client timestamps events: if keystrokes are
 * batched per animation frame, many 0 ms gaps are normal and the fast-gap
 * check must be loosened.
 *
 * Call it only with a trace that reconstructFinalBuffer() accepted.
 */
import { CHARS_PER_WORD } from "@/lib/constants";
import type { EventTrace } from "@/schemas/result.schema";

export type TraceEvents = EventTrace["events"];

export interface PlausibilityThresholds {
  /** Below this many key presses the statistics mean little; verdict is OK. */
  minKeystrokes: number;
  /** Length of the sliding window used for the peak-speed check. */
  peakWindowMs: number;
  /** Peak speed in any window above this goes to review (raw keys / 5, WPM). */
  peakReviewWpm: number;
  /** Peak speed in any window above this is invalid. */
  peakInvalidWpm: number;
  /** A gap between two key presses shorter than this counts as fast. */
  fastGapMs: number;
  /** Share of fast gaps above which the trace goes to review. */
  fastGapReviewShare: number;
  /** Share of fast gaps above which the trace is invalid. */
  fastGapInvalidShare: number;
  /** Bucket size for the coverage check. */
  coverageBucketMs: number;
  /** Share of buckets with a key press below which the trace goes to review. */
  coverageReviewBelow: number;
  /** Share of buckets with a key press below which the trace is invalid. */
  coverageInvalidBelow: number;
  /** Coverage is only checked for tests at least this long. */
  minCoverageDurationMs: number;
  /** Gaps longer than this (pauses) are left out of the variation check. */
  maxGapForCvMs: number;
  /** Minimum number of gaps needed for the variation check. */
  minGapsForCv: number;
  /** Coefficient of variation of gaps below this is suspiciously uniform. */
  gapCvReviewBelow: number;
}

export const DEFAULT_PLAUSIBILITY_THRESHOLDS: PlausibilityThresholds = {
  minKeystrokes: 50,
  peakWindowMs: 5_000,
  peakReviewWpm: 260,
  peakInvalidWpm: 400,
  fastGapMs: 15,
  fastGapReviewShare: 0.25,
  fastGapInvalidShare: 0.6,
  coverageBucketMs: 5_000,
  coverageReviewBelow: 0.7,
  coverageInvalidBelow: 0.3,
  minCoverageDurationMs: 30_000,
  maxGapForCvMs: 1_000,
  minGapsForCv: 100,
  gapCvReviewBelow: 0.25,
};

export type PlausibilityVerdict = "OK" | "REVIEW" | "INVALID";

export interface PlausibilityOptions {
  /** Length of the scored window in ms (the session duration for timed tests). */
  durationMs: number;
  /**
   * True when the trace must span the whole duration: high-trust timed tests,
   * and free tests that did not finish the passage early.
   */
  expectFullDuration: boolean;
  thresholds?: Partial<PlausibilityThresholds>;
}

export interface PlausibilityMetrics {
  keystrokes: number;
  /** Highest speed seen in any window, as WPM (raw keys / 5). */
  peakWindowWpm: number;
  /** Share of gaps between key presses shorter than fastGapMs. */
  fastGapShare: number;
  /** Share of time buckets with at least one key press; null if not checked. */
  coverage: number | null;
  /** Coefficient of variation of gaps; null if too few gaps. */
  gapCv: number | null;
}

export interface PlausibilityResult {
  verdict: PlausibilityVerdict;
  reasons: string[];
  metrics: PlausibilityMetrics;
  /** True when the trace was too short for the statistical checks. */
  insufficientData: boolean;
}

function emptyMetrics(keystrokes: number): PlausibilityMetrics {
  return { keystrokes, peakWindowWpm: 0, fastGapShare: 0, coverage: null, gapCv: null };
}

function keyPressTimes(events: TraceEvents): number[] {
  const times: number[] = [];
  for (const event of events) {
    if (event[1] === 0) {
      times.push(event[0]);
    }
  }
  return times;
}

function gapsBetween(times: readonly number[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push((times[i] as number) - (times[i - 1] as number));
  }
  return gaps;
}

/** Highest speed over any window starting at a key press, as WPM. */
function peakWindowWpm(times: readonly number[], windowMs: number): number {
  let peak = 0;
  let end = 0;
  for (let start = 0; start < times.length; start++) {
    const windowEnd = (times[start] as number) + windowMs;
    if (end < start) {
      end = start;
    }
    while (end < times.length && (times[end] as number) < windowEnd) {
      end++;
    }
    peak = Math.max(peak, end - start);
  }
  return peak / CHARS_PER_WORD / (windowMs / 60_000);
}

function shareWhere(
  values: readonly number[],
  predicate: (value: number) => boolean
): number {
  if (values.length === 0) {
    return 0;
  }
  let matching = 0;
  for (const value of values) {
    if (predicate(value)) {
      matching++;
    }
  }
  return matching / values.length;
}

/** Share of fixed-size time buckets in [0, durationMs) with a key press. */
function coverageOf(
  times: readonly number[],
  durationMs: number,
  bucketMs: number
): number {
  const buckets = Math.max(1, Math.ceil(durationMs / bucketMs));
  const hit = new Set<number>();
  for (const time of times) {
    if (time < durationMs) {
      hit.add(Math.floor(time / bucketMs));
    }
  }
  return hit.size / buckets;
}

/** Coefficient of variation of gaps, ignoring pauses; null if too few gaps. */
function gapVariation(
  gaps: readonly number[],
  maxGapMs: number,
  minGaps: number
): number | null {
  const used = gaps.filter((gap) => gap <= maxGapMs);
  if (used.length < minGaps) {
    return null;
  }
  const mean = used.reduce((sum, gap) => sum + gap, 0) / used.length;
  if (mean === 0) {
    return 0;
  }
  const variance = used.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / used.length;
  return Math.sqrt(variance) / mean;
}

const pct = (value: number) => `${(value * 100).toFixed(0)}%`;

export function assessTracePlausibility(
  events: TraceEvents,
  options: PlausibilityOptions
): PlausibilityResult {
  const t: PlausibilityThresholds = {
    ...DEFAULT_PLAUSIBILITY_THRESHOLDS,
    ...options.thresholds,
  };

  let previous = 0;
  for (const event of events) {
    if (event[0] < previous) {
      return {
        verdict: "INVALID",
        reasons: ["Event timestamps are out of order"],
        metrics: emptyMetrics(0),
        insufficientData: false,
      };
    }
    previous = event[0];
  }

  const times = keyPressTimes(events);
  if (times.length < t.minKeystrokes) {
    return {
      verdict: "OK",
      reasons: [],
      metrics: emptyMetrics(times.length),
      insufficientData: true,
    };
  }

  const gaps = gapsBetween(times);
  const peakWpm = peakWindowWpm(times, t.peakWindowMs);
  const fastGapShare = shareWhere(gaps, (gap) => gap < t.fastGapMs);
  const checkCoverage =
    options.expectFullDuration && options.durationMs >= t.minCoverageDurationMs;
  const coverage = checkCoverage
    ? coverageOf(times, options.durationMs, t.coverageBucketMs)
    : null;
  const gapCv = gapVariation(gaps, t.maxGapForCvMs, t.minGapsForCv);

  const reasons: string[] = [];
  let verdict: PlausibilityVerdict = "OK";
  const flag = (level: "REVIEW" | "INVALID", reason: string) => {
    reasons.push(reason);
    if (level === "INVALID" || verdict === "OK") {
      verdict = level;
    }
  };

  const peakText = `Peak speed ${peakWpm.toFixed(0)} WPM over ${t.peakWindowMs / 1000}s`;
  if (peakWpm > t.peakInvalidWpm) {
    flag("INVALID", `${peakText} is above ${t.peakInvalidWpm} WPM`);
  } else if (peakWpm > t.peakReviewWpm) {
    flag("REVIEW", `${peakText} is above ${t.peakReviewWpm} WPM`);
  }

  const fastText = `${pct(fastGapShare)} of gaps between keystrokes are under ${t.fastGapMs} ms`;
  if (fastGapShare > t.fastGapInvalidShare) {
    flag("INVALID", fastText);
  } else if (fastGapShare > t.fastGapReviewShare) {
    flag("REVIEW", fastText);
  }

  if (coverage !== null) {
    const coverageText = `Keystrokes cover only ${pct(coverage)} of the test duration`;
    if (coverage < t.coverageInvalidBelow) {
      flag("INVALID", coverageText);
    } else if (coverage < t.coverageReviewBelow) {
      flag("REVIEW", coverageText);
    }
  }

  if (gapCv !== null && gapCv < t.gapCvReviewBelow) {
    flag("REVIEW", `Gaps between keystrokes vary too little (CV ${gapCv.toFixed(2)})`);
  }

  return {
    verdict,
    reasons,
    metrics: {
      keystrokes: times.length,
      peakWindowWpm: peakWpm,
      fastGapShare,
      coverage,
      gapCv,
    },
    insufficientData: false,
  };
}

/** Maps a verdict onto the integrity statuses the result record already uses. */
export function plausibilityToIntegrity(
  result: Pick<PlausibilityResult, "verdict">
): "VERIFIED" | "REVIEW" | "INVALID" {
  if (result.verdict === "INVALID") {
    return "INVALID";
  }
  return result.verdict === "REVIEW" ? "REVIEW" : "VERIFIED";
}
