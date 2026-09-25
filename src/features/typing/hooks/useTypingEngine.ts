/**
 * useTypingEngine — Core typing engine hook
 *
 * ─── Architecture ─────────────────────────────────────────────────────────────
 *
 * Performance-critical: ZERO network calls during typing.
 * State management: mutable refs for hot-path state to avoid rerenders.
 * React state: only updated at meaningful milestones (word complete, finish).
 *
 * Data flow:
 *   Keyboard event
 *   → handleKey() / handleBackspace()
 *   → update mutable ref state
 *   → requestAnimationFrame tick updates displayed state
 *   → on test complete: single setState flush → single POST to /api/result
 *
 * This design ensures typing latency is limited only by the browser event
 * loop, not by React's render cycle or any network call.
 *
 * ─── Rerender policy ──────────────────────────────────────────────────────────
 *
 * React state is updated:
 * - Every word completion (for progress display)
 * - Every second (for timer display via rAF)
 * - On status changes (idle → active → completed)
 * - NOT on every individual keystroke
 *
 * Mutable refs hold the hot-path state that is read back on completion.
 */
"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EventTrace } from "@/schemas/result.schema";
import {
  calculateWpm,
  calculateRawWpm,
  calculateNetWpm,
  calculateAccuracy,
  calculateConsistency,
} from "../lib/metrics";
import type {
  TypingEngineState,
  TypingEngineConfig,
  KeyErrorMap,
  ErrorMap,
  IntegritySignals,
  EngineStatus,
} from "@/types/typing";

// ─── Interval WPM tracking ────────────────────────────────────────────────────

/** Track WPM every N milliseconds for consistency calculation */
const INTERVAL_MS = 5_000;

// ─── Initial state factory ────────────────────────────────────────────────────

function createInitialSignals(): IntegritySignals {
  return {
    pasteAttempts: 0,
    copyAttempts: 0,
    focusLossCount: 0,
    visibilityChanges: 0,
    suspiciousPattern: false,
    intervalWpms: [],
    selectionAttempts: 0,
  };
}

function createInitialEngineState(): TypingEngineState {
  return {
    status: "idle",
    startedAt: null,
    elapsedMs: 0,
    remainingMs: null,
    currentIndex: 0,
    currentWordIndex: 0,
    correctCharacters: 0,
    incorrectCharacters: 0,
    totalCharacters: 0,
    correctedErrors: 0,
    uncorrectedErrors: 0,
    wpm: 0,
    rawWpm: 0,
    netWpm: 0,
    accuracy: 1,
    consistency: 0,
    keyErrors: {},
    errorMap: {},
    completed: false,
    paused: false,
    integritySignals: createInitialSignals(),
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseTypingEngineReturn {
  /** Current React state — updated at milestones, not every keystroke */
  state: TypingEngineState;
  /** The passage split into individual characters */
  chars: string[];
  /** Start the test (called on first keypress or explicit start) */
  start: () => void;
  /** Pause the test */
  pause: () => void;
  /** Resume a paused test */
  resume: () => void;
  /** Reset to initial state */
  reset: () => void;
  /** Manually finish the test */
  finish: () => void;
  /** Handle a printable character keystroke */
  handleKey: (char: string) => void;
  /** Handle backspace keystroke */
  handleBackspace: () => void;
}

export function useTypingEngine(config: TypingEngineConfig): UseTypingEngineReturn {
  const { passage, mode, duration, wordCount, onComplete, onProgress } = config;

  // ── React state (triggers rerenders) ──
  const [state, setState] = useState<TypingEngineState>(createInitialEngineState);

  // ── Mutable refs (hot-path — no rerender on change) ──
  const statusRef = useRef<EngineStatus>("idle");
  const startedAtRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const totalPausedMsRef = useRef(0);
  const currentIndexRef = useRef(0);
  const currentWordIndexRef = useRef(0);
  const correctCharsRef = useRef(0);
  const incorrectCharsRef = useRef(0);
  const totalCharsRef = useRef(0);
  const correctedErrorsRef = useRef(0);
  const uncorrectedErrorsRef = useRef(0);
  const keyErrorsRef = useRef<KeyErrorMap>({});
  const errorMapRef = useRef<ErrorMap>({});
  const signalsRef = useRef<IntegritySignals>(createInitialSignals());
  const intervalWpmsRef = useRef<number[]>([]);
  const lastIntervalAtRef = useRef<number>(0);
  const totalKeystrokes = useRef(0);
  const eventTraceRef = useRef<EventTrace["events"]>([]);

  // Latest onComplete, read when the test finishes. The rAF `tick` loop is
  // memoized per (mode, duration), so anything it closes over can be from the
  // first render — before the caller had a session. Reading through a ref
  // keeps timer expiry calling the current onComplete.
  const onCompleteRef = useRef(onComplete);
  useLayoutEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // ── Derived ──
  // Stable per passage: the rAF loop re-renders every frame, and a fresh array
  // would recreate handleKey and the rendered passage lines each time.
  const chars = useMemo(() => passage.split(""), [passage]);
  const durationMs = (duration ?? 0) * 1000;

  // ─── rAF loop ──────────────────────────────────────────────────────────────

  const rafRef = useRef<number | null>(null);

  const flushState = useCallback(() => {
    const now = Date.now();
    const startedAt = startedAtRef.current;
    if (!startedAt) return;

    const rawElapsed = now - startedAt - totalPausedMsRef.current;
    const elapsedMs = Math.max(0, rawElapsed);

    const correct = correctCharsRef.current;
    const total = totalCharsRef.current;
    const uncorrected = uncorrectedErrorsRef.current;

    const wpm = calculateWpm(correct, elapsedMs);
    const rawWpm = calculateRawWpm(total, elapsedMs);
    const netWpm = calculateNetWpm(wpm, uncorrected, elapsedMs);
    const accuracy = calculateAccuracy(correct, total);
    const consistency = calculateConsistency(intervalWpmsRef.current) ?? 0;

    const remainingMs =
      mode === "timed" && durationMs > 0 ? Math.max(0, durationMs - elapsedMs) : null;

    setState((prev) => ({
      ...prev,
      status: statusRef.current,
      startedAt: startedAtRef.current,
      elapsedMs,
      remainingMs,
      currentIndex: currentIndexRef.current,
      currentWordIndex: currentWordIndexRef.current,
      correctCharacters: correct,
      incorrectCharacters: incorrectCharsRef.current,
      totalCharacters: total,
      correctedErrors: correctedErrorsRef.current,
      uncorrectedErrors: uncorrected,
      wpm,
      rawWpm,
      netWpm,
      accuracy,
      consistency,
      keyErrors: { ...keyErrorsRef.current },
      errorMap: { ...errorMapRef.current },
      integritySignals: { ...signalsRef.current },
    }));

    onProgress?.({
      status: statusRef.current,
      startedAt: startedAtRef.current,
      elapsedMs,
      remainingMs,
      currentIndex: currentIndexRef.current,
      currentWordIndex: currentWordIndexRef.current,
      correctCharacters: correct,
      incorrectCharacters: incorrectCharsRef.current,
      totalCharacters: total,
      correctedErrors: correctedErrorsRef.current,
      uncorrectedErrors: uncorrected,
      wpm,
      rawWpm,
      netWpm,
      accuracy,
      consistency,
      keyErrors: keyErrorsRef.current,
      errorMap: errorMapRef.current,
      completed: false,
      paused: statusRef.current === "paused",
      integritySignals: signalsRef.current,
    });
  }, [mode, durationMs, onProgress]);

  const tick = useCallback(() => {
    if (statusRef.current !== "active") return;

    const now = Date.now();
    const startedAt = startedAtRef.current;
    if (!startedAt) return;

    const elapsed = now - startedAt - totalPausedMsRef.current;

    // Collect interval WPM for consistency tracking
    if (elapsed - lastIntervalAtRef.current >= INTERVAL_MS) {
      const wpm = calculateWpm(correctCharsRef.current, elapsed);
      intervalWpmsRef.current = [...intervalWpmsRef.current, wpm];
      signalsRef.current = {
        ...signalsRef.current,
        intervalWpms: intervalWpmsRef.current,
      };
      lastIntervalAtRef.current = elapsed;
    }

    // Check timed test expiry
    if (mode === "timed" && durationMs > 0 && elapsed >= durationMs) {
      finishInternal();
      return;
    }

    flushState();
    rafRef.current = requestAnimationFrame(tick);
    // finishInternal is stable (it reads onComplete through onCompleteRef), so
    // omitting it here cannot capture a stale completion handler.
  }, [mode, durationMs, flushState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Internal finish ────────────────────────────────────────────────────────

  const finishInternal = useCallback(() => {
    if (statusRef.current === "completed") return;
    statusRef.current = "completed";

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const startedAt = startedAtRef.current ?? Date.now();
    const elapsedMs = Date.now() - startedAt - totalPausedMsRef.current;

    const correct = correctCharsRef.current;
    const total = totalCharsRef.current;
    const uncorrected = uncorrectedErrorsRef.current;

    const wpm = calculateWpm(correct, elapsedMs);
    const rawWpm = calculateRawWpm(total, elapsedMs);
    const netWpm = calculateNetWpm(wpm, uncorrected, elapsedMs);
    const accuracy = calculateAccuracy(correct, total);
    const consistency = calculateConsistency(intervalWpmsRef.current) ?? 0;

    const finalState: TypingEngineState = {
      status: "completed",
      startedAt,
      elapsedMs,
      remainingMs: 0,
      currentIndex: currentIndexRef.current,
      currentWordIndex: currentWordIndexRef.current,
      correctCharacters: correct,
      incorrectCharacters: incorrectCharsRef.current,
      totalCharacters: total,
      correctedErrors: correctedErrorsRef.current,
      uncorrectedErrors: uncorrected,
      wpm,
      rawWpm,
      netWpm,
      accuracy,
      consistency,
      keyErrors: { ...keyErrorsRef.current },
      errorMap: { ...errorMapRef.current },
      completed: true,
      paused: false,
      integritySignals: signalsRef.current,
      eventTrace: {
        events: eventTraceRef.current,
        totalEvents: eventTraceRef.current.length,
        durationMs: elapsedMs,
      },
    };

    setState(finalState);
    onCompleteRef.current?.(finalState);
  }, []);

  // ─── Public API ─────────────────────────────────────────────────────────────

  const start = useCallback(() => {
    if (statusRef.current !== "idle") return;
    statusRef.current = "active";
    startedAtRef.current = Date.now();
    lastIntervalAtRef.current = 0;
    setState((prev) => ({
      ...prev,
      status: "active",
      startedAt: startedAtRef.current,
    }));
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const pause = useCallback(() => {
    if (statusRef.current !== "active") return;
    statusRef.current = "paused";
    pausedAtRef.current = Date.now();

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    setState((prev) => ({ ...prev, status: "paused", paused: true }));
  }, []);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return;
    statusRef.current = "active";

    if (pausedAtRef.current) {
      totalPausedMsRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }

    setState((prev) => ({ ...prev, status: "active", paused: false }));
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const reset = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Reset all refs
    statusRef.current = "idle";
    startedAtRef.current = null;
    pausedAtRef.current = null;
    totalPausedMsRef.current = 0;
    currentIndexRef.current = 0;
    currentWordIndexRef.current = 0;
    correctCharsRef.current = 0;
    incorrectCharsRef.current = 0;
    totalCharsRef.current = 0;
    correctedErrorsRef.current = 0;
    uncorrectedErrorsRef.current = 0;
    keyErrorsRef.current = {};
    errorMapRef.current = {};
    signalsRef.current = createInitialSignals();
    intervalWpmsRef.current = [];
    lastIntervalAtRef.current = 0;
    totalKeystrokes.current = 0;
    eventTraceRef.current = [];

    setState(createInitialEngineState());
  }, []);

  const finish = useCallback(() => {
    finishInternal();
  }, [finishInternal]);

  // ─── handleKey ─────────────────────────────────────────────────────────────

  const handleKey = useCallback(
    (char: string) => {
      // Auto-start on first key
      if (statusRef.current === "idle") {
        statusRef.current = "active";
        startedAtRef.current = Date.now();
        lastIntervalAtRef.current = 0;
        setState((prev) => ({
          ...prev,
          status: "active",
          startedAt: startedAtRef.current,
        }));
        rafRef.current = requestAnimationFrame(tick);
      }

      if (statusRef.current !== "active") return;

      const idx = currentIndexRef.current;
      if (idx >= chars.length) {
        // Past end of passage
        finishInternal();
        return;
      }

      const expectedChar = chars[idx];
      totalCharsRef.current += 1;
      totalKeystrokes.current += 1;

      if (char === expectedChar) {
        correctCharsRef.current += 1;
        // Clear any previous error at this position if it was marked
        if (errorMapRef.current[idx]) {
          errorMapRef.current = { ...errorMapRef.current };
          delete errorMapRef.current[idx];
        }
      } else {
        incorrectCharsRef.current += 1;
        uncorrectedErrorsRef.current += 1;

        // Track key error
        const existing = keyErrorsRef.current[expectedChar ?? ""];
        keyErrorsRef.current = {
          ...keyErrorsRef.current,
          [expectedChar ?? ""]: {
            expected: expectedChar ?? "",
            actual: [...(existing?.actual?.slice(-4) ?? []), char],
            count: (existing?.count ?? 0) + 1,
            corrected: existing?.corrected ?? 0,
            uncorrected: (existing?.uncorrected ?? 0) + 1,
          },
        };

        // Mark error position
        errorMapRef.current = {
          ...errorMapRef.current,
          [idx]: {
            expected: expectedChar ?? "",
            typed: char,
            corrected: false,
          },
        };
      }

      const elapsed =
        Date.now() - (startedAtRef.current ?? Date.now()) - totalPausedMsRef.current;
      if (eventTraceRef.current.length < 12000) {
        eventTraceRef.current.push([Math.max(0, elapsed), 0, idx, char]);
      }

      currentIndexRef.current += 1;

      // Update word index
      if (expectedChar === " ") {
        currentWordIndexRef.current += 1;
      }

      // Word-count mode: check completion
      if (mode === "words" && wordCount) {
        const wordsTyped = currentWordIndexRef.current;
        const lastCharIsSpace = expectedChar === " ";
        const atEnd = currentIndexRef.current >= chars.length;
        if (atEnd || (!lastCharIsSpace && wordsTyped >= wordCount)) {
          finishInternal();
          return;
        }
      }

      // End of passage
      if (currentIndexRef.current >= chars.length) {
        finishInternal();
      }
    },
    [chars, mode, wordCount, tick, finishInternal]
  );

  // ─── handleBackspace ────────────────────────────────────────────────────────

  const handleBackspace = useCallback(() => {
    if (statusRef.current !== "active") return;
    if (currentIndexRef.current <= 0) return;

    totalKeystrokes.current += 1;

    const prevIdx = currentIndexRef.current - 1;
    const prevError = errorMapRef.current[prevIdx];

    if (prevError && !prevError.corrected) {
      // Correcting an error
      incorrectCharsRef.current = Math.max(0, incorrectCharsRef.current - 1);
      uncorrectedErrorsRef.current = Math.max(0, uncorrectedErrorsRef.current - 1);
      correctedErrorsRef.current += 1;

      // Mark as corrected in error map
      errorMapRef.current = {
        ...errorMapRef.current,
        [prevIdx]: { ...prevError, corrected: true },
      };

      // Update key error tracking
      const expectedChar = prevError.expected;
      const existing = keyErrorsRef.current[expectedChar];
      if (existing) {
        keyErrorsRef.current = {
          ...keyErrorsRef.current,
          [expectedChar]: {
            ...existing,
            corrected: existing.corrected + 1,
            uncorrected: Math.max(0, existing.uncorrected - 1),
          },
        };
      }
    }

    const elapsed =
      Date.now() - (startedAtRef.current ?? Date.now()) - totalPausedMsRef.current;
    if (eventTraceRef.current.length < 12000) {
      eventTraceRef.current.push([Math.max(0, elapsed), 1, prevIdx]);
    }

    // Move back
    currentIndexRef.current -= 1;
    totalCharsRef.current = Math.max(0, totalCharsRef.current - 1);

    // Adjust word index if we crossed a space
    const charAtPrev = chars[currentIndexRef.current];
    if (charAtPrev === " " && currentWordIndexRef.current > 0) {
      currentWordIndexRef.current -= 1;
    }
  }, [chars]);

  // ─── Integrity monitoring ────────────────────────────────────────────────────

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      signalsRef.current = {
        ...signalsRef.current,
        pasteAttempts: signalsRef.current.pasteAttempts + 1,
        suspiciousPattern: true,
      };
    };

    const handleCopy = () => {
      if (statusRef.current === "active") {
        signalsRef.current = {
          ...signalsRef.current,
          copyAttempts: signalsRef.current.copyAttempts + 1,
        };
      }
    };

    const handleBlur = () => {
      if (statusRef.current === "active") {
        signalsRef.current = {
          ...signalsRef.current,
          focusLossCount: signalsRef.current.focusLossCount + 1,
        };
      }
    };

    const handleVisibilityChange = () => {
      if (statusRef.current === "active" && document.hidden) {
        signalsRef.current = {
          ...signalsRef.current,
          visibilityChanges: signalsRef.current.visibilityChanges + 1,
        };
      }
    };

    const handleSelect = () => {
      if (statusRef.current === "active") {
        const selection = window.getSelection();
        if (selection && selection.toString().length > 0) {
          signalsRef.current = {
            ...signalsRef.current,
            selectionAttempts: signalsRef.current.selectionAttempts + 1,
          };
        }
      }
    };

    document.addEventListener("paste", handlePaste);
    document.addEventListener("copy", handleCopy);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("selectionchange", handleSelect);

    return () => {
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("copy", handleCopy);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("selectionchange", handleSelect);
    };
  }, []);

  // ─── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // ─── Recalculate consistency on passage change (reset) ─────────────────────

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passage]);

  return {
    state,
    chars,
    start,
    pause,
    resume,
    reset,
    finish,
    handleKey,
    handleBackspace,
  };
}
