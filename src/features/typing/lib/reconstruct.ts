import type { EventTrace } from "@/schemas/result.schema";

export interface ReconstructedMetrics {
  isValidTrace: boolean;
  correctChars: number;
  incorrectChars: number;
  totalChars: number;
  correctedErrors: number;
  uncorrectedErrors: number;
  lastEventTimeMs: number;
  isPassageCompleted: boolean;
}

export function reconstructFinalBuffer(
  passage: string,
  eventTrace: EventTrace
): ReconstructedMetrics {
  const events = eventTrace.events;

  let recCorrect = 0;
  let recIncorrect = 0;
  let recTotal = 0;
  let recCorrected = 0;
  let recUncorrected = 0;
  let lastEventTimeMs = 0;

  const buffer: { char: string; expected: string; isCorrect: boolean }[] = [];

  let isValidTrace = true;

  for (const event of events) {
    const [timestamp, type, index, charPayload] = event;

    if (timestamp < 0 || timestamp < lastEventTimeMs) {
      isValidTrace = false;
      break;
    }
    lastEventTimeMs = timestamp;

    if (type === 0 && charPayload !== undefined) {
      if (index !== buffer.length || index >= passage.length) {
        isValidTrace = false;
        break;
      }
      const expected = passage[index] as string;
      const isCorrect = charPayload === expected;
      buffer.push({ char: charPayload, expected, isCorrect });
      recTotal++;
    } else if (type === 1) {
      if (buffer.length === 0 || index !== buffer.length - 1) {
        isValidTrace = false;
        break;
      }
      const removed = buffer.pop();
      if (removed && !removed.isCorrect) {
        recCorrected++;
      }
    } else {
      isValidTrace = false;
      break;
    }
  }

  if (isValidTrace) {
    for (const item of buffer) {
      if (item.isCorrect) recCorrect++;
      else {
        recIncorrect++;
        recUncorrected++;
      }
    }
  }

  const isPassageCompleted = buffer.length === passage.length;

  return {
    isValidTrace,
    correctChars: recCorrect,
    incorrectChars: recIncorrect,
    totalChars: recTotal,
    correctedErrors: recCorrected,
    uncorrectedErrors: recUncorrected,
    lastEventTimeMs,
    isPassageCompleted,
  };
}
