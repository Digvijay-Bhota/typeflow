/**
 * Core typing domain types.
 *
 * These types define the shape of the typing engine state and
 * the session payload sent to the server after test completion.
 *
 * IMPORTANT: The server NEVER trusts client-submitted WPM/accuracy.
 * It re-derives all metrics from passage + elapsed time.
 * The client submission is used for integrity checking only.
 */

import type {
  TypingMode,
  Language,
  CodeLanguage,
  Difficulty,
  IntegrityStatus,
  TestDuration,
  WordCount,
} from "@/lib/constants";

// ─── Engine State ─────────────────────────────────────────────────────────────

/** The complete state of the typing engine at any point in time. */
export interface TypingEngineState {
  // ── Status ──
  status: EngineStatus;
  startedAt: number | null; // Date.now() when started
  elapsedMs: number; // elapsed time in ms
  remainingMs: number | null; // null for word-count mode

  // ── Position ──
  currentIndex: number; // current char index in passage
  currentWordIndex: number; // current word index

  // ── Character counts ──
  correctCharacters: number;
  incorrectCharacters: number;
  totalCharacters: number; // total typed (correct + incorrect)
  correctedErrors: number; // errors fixed with backspace
  uncorrectedErrors: number; // errors left at submission

  // ── Derived metrics (computed live from the above) ──
  /**
   * WPM formula: (correctCharacters / CHARS_PER_WORD) / (elapsedMs / 60000)
   * Standard: 1 word = 5 characters.
   */
  wpm: number;
  /**
   * Raw WPM formula: (totalCharacters / CHARS_PER_WORD) / (elapsedMs / 60000)
   * Counts all keystrokes including errors.
   */
  rawWpm: number;
  /**
   * Net WPM formula: WPM - (uncorrectedErrors / minutes)
   * Penalizes uncorrected errors.
   */
  netWpm: number;
  /**
   * Accuracy formula: correctCharacters / totalCharacters
   * Ratio 0–1. 1.0 = perfect.
   */
  accuracy: number;
  /**
   * Consistency: measures how stable the typing speed is across intervals.
   * Computed as: 1 - (stdDev(intervalWpms) / mean(intervalWpms))
   * Ratio 0–1. 1.0 = perfectly consistent speed.
   */
  consistency: number;

  // ── Error tracking ──
  /**
   * Per-key error map: { [key: expected char]: { count: number, corrected: number } }
   * Aggregated — NOT a raw keystroke log.
   */
  keyErrors: KeyErrorMap;
  /** Character-level error positions for visual highlighting */
  errorMap: ErrorMap;

  // ── Completion ──
  completed: boolean;
  paused: boolean;

  // ── Integrity signals (client-side only, sent to server for review) ──
  integritySignals: IntegritySignals;
  eventTrace?: {
    events: [number, number, number, string?][];
    totalEvents: number;
    durationMs: number;
  };
}

export type EngineStatus = "idle" | "active" | "paused" | "completed";

// ─── Key Error Tracking ───────────────────────────────────────────────────────

/**
 * Aggregated per-key error tracking.
 * key = the character that was expected.
 */
export type KeyErrorMap = Record<
  string,
  {
    expected: string;
    actual: string[]; // what was typed instead (up to last N)
    count: number; // total errors on this expected key
    corrected: number; // how many were corrected with backspace
    uncorrected: number; // how many remain uncorrected
  }
>;

/**
 * Position-level error map for visual display.
 * key = character index in passage.
 */
export type ErrorMap = Record<
  number,
  {
    expected: string;
    typed: string;
    corrected: boolean;
  }
>;

// ─── Integrity Signals ────────────────────────────────────────────────────────

/**
 * Client-side integrity signals.
 * Sent to server after test completion.
 * The SERVER determines eligibility — client signals are inputs only.
 */
export interface IntegritySignals {
  /** Number of paste attempts detected */
  pasteAttempts: number;
  /** Number of copy attempts detected */
  copyAttempts: number;
  /** Number of times window lost focus */
  focusLossCount: number;
  /** Number of visibility change events (tab switch) */
  visibilityChanges: number;
  /** Whether any suspicious event pattern was detected */
  suspiciousPattern: boolean;
  /** Array of interval WPMs for consistency analysis */
  intervalWpms: number[];
  /** Whether selection was attempted during test */
  selectionAttempts: number;
}

// ─── Engine Config ────────────────────────────────────────────────────────────

/** Configuration passed when initializing a typing session. */
export interface TypingEngineConfig {
  passage: string;
  mode: TypingMode;
  language: Language;
  duration?: TestDuration | undefined; // seconds, for timed mode
  wordCount?: WordCount | undefined; // for word-count mode
  codeLanguage?: CodeLanguage | undefined;
  isCertificateMode?: boolean | undefined;
  onComplete?: ((state: TypingEngineState) => void) | undefined;
  onProgress?: ((state: TypingEngineState) => void) | undefined;
}

// ─── Session Payload (client → server) ───────────────────────────────────────

/**
 * Payload submitted to /api/result after test completion.
 * Server validates and re-derives all metrics.
 * Client-submitted metrics are for cross-checking only.
 */
export interface TestSessionPayload {
  sessionId: string;
  /** Client-side elapsed time (server compares with session timestamps) */
  clientElapsedMs: number;
  /** Client-derived metrics — for server cross-check, not trusted as-is */
  clientMetrics: {
    wpm: number;
    rawWpm: number;
    accuracy: number;
    correctChars: number;
    incorrectChars: number;
    totalChars: number;
    correctedErrors: number;
    uncorrectedErrors: number;
    consistency: number;
  };
  /** Aggregated error data (no raw keystroke log) */
  errorMap: ErrorMap;
  /** Integrity signals */
  integritySignals: IntegritySignals;
}

// ─── Result (server → client) ────────────────────────────────────────────────

/** Public result data returned from server */
export interface TestResultPublic {
  // No internal database id: results are addressed publicly by shareId only.
  shareId: string;
  shareUrl: string;
  wpm: number;
  rawWpm: number;
  netWpm: number;
  accuracy: number;
  consistency: number | null;
  correctChars: number;
  incorrectChars: number;
  totalChars: number;
  correctedErrors: number;
  uncorrectedErrors: number;
  elapsedMs: number;
  duration: number | null;
  mode: string;
  language: string;
  codeLanguage?: string;
  errorMap: Record<
    string,
    { expected: string; count: number; corrected: number; uncorrected: number }
  > | null;
  codeMetrics?: any;
  integrityStatus: IntegrityStatus;
  /**
   * SERVER_RECONSTRUCTED: every metric and diagnostic was derived server-side
   * from the event trace. CLIENT_COUNTS: values are client-reported.
   */
  scoringSource: "CLIENT_COUNTS" | "SERVER_RECONSTRUCTED";
  createdAt: string;
  /** Same rule as certificate issuance (evaluateCertificateEligibility). */
  isCertificateEligible: boolean;
  displayName?: string | null;
  certificateId?: string | null;
}

// ─── Passage ─────────────────────────────────────────────────────────────────

export interface PassageData {
  id: string;
  content: string;
  language: Language;
  difficulty: Difficulty;
  mode: string;
  wordCount: number;
  charCount: number;
  codeLanguage?: CodeLanguage;
  sourceAttribution?: string | null;
}

// ─── Session Init Response (server → client) ─────────────────────────────────

export interface SessionInitResponse {
  sessionId: string;
  passage: PassageData;
  integrityToken: string;
  expiresAt: string;
}
