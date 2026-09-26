/**
 * Server-side trace diagnostics.
 *
 * Derives the display diagnostics that the client also computes — per-key
 * errors, per-position errors, interval WPM and consistency — from the
 * authoritative event trace, so a SERVER_RECONSTRUCTED result carries no
 * client-reported values.
 *
 * Only call this with a trace that reconstructFinalBuffer() accepted
 * (isValidTrace === true); it assumes indices and ordering are valid.
 */
import type { EventTrace } from "@/schemas/result.schema";
import type { ErrorMap, KeyErrorMap } from "@/types/typing";
import { calculateConsistency, calculateWpm } from "./metrics";

/** Same sampling interval the client engine uses for consistency. */
export const TRACE_INTERVAL_MS = 5_000;

/** How many recent wrong keys are kept per expected key (mirrors the engine). */
const MAX_ACTUAL_SAMPLES = 5;

export interface TraceDiagnostics {
  /** Per expected key: { expected, actual[], count, corrected, uncorrected } */
  keyErrors: KeyErrorMap;
  /** Per passage index: { expected, typed, corrected } */
  positionErrors: ErrorMap;
  /** WPM of the final-buffer correct characters at each 5 s boundary */
  intervalWpms: number[];
  /** 1 − coefficient of variation of intervalWpms, or null if too short */
  consistency: number | null;
}

/**
 * Replays the trace with the typing engine's error bookkeeping:
 *
 * - wrong keypress  → keyErrors[expected].count/uncorrected += 1,
 *                     positionErrors[idx] = { corrected: false }
 * - right keypress  → positionErrors[idx] is cleared
 * - backspace over an uncorrected error → corrected += 1, uncorrected -= 1,
 *                     positionErrors[idx].corrected = true
 *
 * Interval WPM differs deliberately from the client: it counts correct
 * characters remaining in the buffer at each boundary (the same basis as
 * reconstruction), so typing and deleting correct characters cannot inflate it.
 *
 * Formula (per interval boundary t = k × 5 s, up to the last event):
 *   intervalWpm(t) = calculateWpm(correctCharsInBuffer(t), t)
 */
export function deriveTraceDiagnostics(
  passage: string,
  eventTrace: EventTrace
): TraceDiagnostics {
  const keyErrors: KeyErrorMap = {};
  const positionErrors: ErrorMap = {};
  const buffer: boolean[] = []; // isCorrect per typed position
  let correctInBuffer = 0;

  const intervalWpms: number[] = [];
  let nextBoundary = TRACE_INTERVAL_MS;

  for (const event of eventTrace.events) {
    const [timestamp, type, index] = event;

    while (timestamp >= nextBoundary) {
      intervalWpms.push(calculateWpm(correctInBuffer, nextBoundary));
      nextBoundary += TRACE_INTERVAL_MS;
    }

    const expected = passage[index] ?? "";

    if (type === 0) {
      const typed = event[3] ?? "";
      const isCorrect = typed === expected;
      buffer.push(isCorrect);

      if (isCorrect) {
        correctInBuffer++;
        delete positionErrors[index];
      } else {
        const existing = keyErrors[expected];
        keyErrors[expected] = {
          expected,
          actual: [...(existing?.actual.slice(-(MAX_ACTUAL_SAMPLES - 1)) ?? []), typed],
          count: (existing?.count ?? 0) + 1,
          corrected: existing?.corrected ?? 0,
          uncorrected: (existing?.uncorrected ?? 0) + 1,
        };
        positionErrors[index] = { expected, typed, corrected: false };
      }
    } else {
      const removedWasCorrect = buffer.pop();
      if (removedWasCorrect) correctInBuffer--;

      const error = positionErrors[index];
      if (error && !error.corrected) {
        positionErrors[index] = { ...error, corrected: true };
        const keyError = keyErrors[error.expected];
        if (keyError) {
          keyErrors[error.expected] = {
            ...keyError,
            corrected: keyError.corrected + 1,
            uncorrected: Math.max(0, keyError.uncorrected - 1),
          };
        }
      }
    }
  }

  return {
    keyErrors,
    positionErrors,
    intervalWpms,
    consistency: calculateConsistency(intervalWpms),
  };
}
