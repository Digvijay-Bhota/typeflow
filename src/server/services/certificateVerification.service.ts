import {
  calculateWpm,
  calculateRawWpm,
  calculateNetWpm,
  calculateAccuracy,
} from "@/features/typing/lib/metrics";

export interface ReconstructedMetrics {
  correctChars: number;
  incorrectChars: number;
  totalChars: number;
  correctedErrors: number;
  uncorrectedErrors: number;
  wpm: number;
  rawWpm: number;
  netWpm: number;
  accuracy: number;
}

export interface VerifyCertificateResult {
  status: "VERIFIED" | "REVIEW" | "INVALID";
  reasons: string[];
  reconstructed: ReconstructedMetrics | null;
}

/**
 * Pure deterministic validator for certificate tests.
 * Reconstructs the exact typing session from the event trace.
 */
export function verifyCertificateTest(
  passageContent: string,
  eventTrace: [number, number, number, string?][],
  serverElapsedMs: number
): VerifyCertificateResult {
  let currentIndex = 0;
  let correctChars = 0;
  let incorrectChars = 0;
  let totalChars = 0;
  let correctedErrors = 0;
  let uncorrectedErrors = 0;
  const chars = passageContent.split("");

  const errorMap: Record<
    number,
    { expected: string; typed: string; corrected: boolean }
  > = {};

  let lastTimeMs = -1;
  let status: "VERIFIED" | "REVIEW" | "INVALID" = "VERIFIED";
  const reasons: string[] = [];

  if (!eventTrace || eventTrace.length === 0) {
    return { status: "INVALID", reasons: ["Empty event trace"], reconstructed: null };
  }

  // Iterate exactly as the typing engine does
  for (const event of eventTrace) {
    const [timeMs, type, idx, char] = event;

    if (timeMs < 0) {
      status = "INVALID";
      reasons.push("Negative timestamp");
      break;
    }

    // Check if time is after server duration + grace
    if (timeMs > serverElapsedMs + 5000) {
      status = "INVALID";
      reasons.push("Event recorded significantly after test duration");
      break;
    }

    if (timeMs < lastTimeMs) {
      status = "INVALID";
      reasons.push("Events out of order");
      break;
    }
    lastTimeMs = timeMs;

    if (type === 0) {
      if (idx !== currentIndex) {
        status = "INVALID";
        reasons.push(`Index mismatch: expected ${currentIndex}, got ${idx}`);
        break;
      }
      // Keypress
      if (idx >= chars.length) {
        status = "INVALID";
        reasons.push("Event index out of bounds");
        break;
      }

      const expectedChar = chars[idx];
      totalChars++;

      if (char === expectedChar) {
        correctChars++;
        if (errorMap[idx]) {
          delete errorMap[idx];
        }
      } else {
        incorrectChars++;
        uncorrectedErrors++;
        errorMap[idx] = {
          expected: expectedChar ?? "",
          typed: char || "",
          corrected: false,
        };
      }

      currentIndex++;
    } else if (type === 1) {
      // Backspace
      if (currentIndex <= 0) {
        status = "INVALID";
        reasons.push("Backspace out of bounds");
        break;
      }
      if (idx !== currentIndex - 1) {
        status = "INVALID";
        reasons.push(
          `Index mismatch on backspace: expected ${currentIndex - 1}, got ${idx}`
        );
        break;
      }

      const prevIdx = currentIndex - 1;
      const prevError = errorMap[prevIdx];

      if (prevError && !prevError.corrected) {
        incorrectChars = Math.max(0, incorrectChars - 1);
        uncorrectedErrors = Math.max(0, uncorrectedErrors - 1);
        correctedErrors++;
        errorMap[prevIdx] = { ...errorMap[prevIdx]!, corrected: true };
      }

      currentIndex--;
      totalChars = Math.max(0, totalChars - 1);
    } else {
      status = "INVALID";
      reasons.push("Unknown event type");
      break;
    }
  }

  if (status === "INVALID") {
    return { status, reasons, reconstructed: null };
  }

  const wpm = calculateWpm(correctChars, serverElapsedMs);
  const rawWpm = calculateRawWpm(totalChars, serverElapsedMs);
  const netWpm = calculateNetWpm(wpm, uncorrectedErrors, serverElapsedMs);
  const accuracy = calculateAccuracy(correctChars, totalChars);

  if (wpm > 300) {
    status = "INVALID";
    reasons.push("WPM exceeds human limits");
  }

  return {
    status,
    reasons,
    reconstructed: {
      correctChars,
      incorrectChars,
      totalChars,
      correctedErrors,
      uncorrectedErrors,
      wpm,
      rawWpm,
      netWpm,
      accuracy,
    },
  };
}
