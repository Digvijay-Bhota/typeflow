"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTypingEngine } from "../hooks/useTypingEngine";
import { TypingArea } from "./TypingArea";
import { TypingStats } from "./TypingStats";
import { TestConfig } from "./TestConfig";
import { cn } from "@/lib/utils";
import type { TypingEngineState, SessionInitResponse } from "@/types/typing";
import type { TypingMode, TestDuration, WordCount, Language } from "@/lib/constants";
import { DEFAULT_DURATION, DEFAULT_WORD_COUNT } from "@/lib/constants";

export function TypingTest({
  className,
  mode: initialMode,
  language: initialLanguage,
  codeLanguage: initialCodeLanguage,
  duration: initialDuration,
  wordCount: initialWordCount,
  trustTier: initialTrustTier,
  sourceResultId,
  hideConfig,
}: {
  className?: string;
  mode?: TypingMode | undefined;
  language?: string | undefined;
  codeLanguage?: string | undefined;
  duration?: number | undefined;
  wordCount?: number | undefined;
  trustTier?: string | undefined;
  sourceResultId?: string | undefined;
  hideConfig?: boolean;
}) {
  const router = useRouter();

  // ── Config state ─────────────────────────────────────────────────────────
  const [mode, setMode] = useState<TypingMode>(initialMode || "timed");
  const [language] = useState<string>(initialLanguage || "english");
  const [codeLanguage] = useState<string | undefined>(initialCodeLanguage);
  const [duration, setDuration] = useState<TestDuration>(
    (initialDuration as TestDuration) || DEFAULT_DURATION
  );
  const [wordCount, setWordCount] = useState<WordCount>(
    (initialWordCount as WordCount) || DEFAULT_WORD_COUNT
  );
  const [trustTier] = useState(initialTrustTier || "FREE");

  // ── Backend Session state ────────────────────────────────────────────────
  const [session, setSession] = useState<SessionInitResponse | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const sessionStarted = useRef(false);
  const finalStateRef = useRef<TypingEngineState | null>(null);

  // ── Create Session ───────────────────────────────────────────────────────
  const fetchSession = useCallback(async () => {
    setLoadingSession(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          language: language.toLowerCase(),
          codeLanguage: codeLanguage?.toLowerCase(),
          duration: mode === "timed" ? duration : undefined,
          wordCount: mode === "words" ? wordCount : undefined,
          trustTier,
          sourceResultId,
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const data = await res.json();
      setSession(data);
      sessionStarted.current = false;
      submittingRef.current = false;
      finalStateRef.current = null;
      setSubmitting(false);
    } catch (e) {
      console.error(e);
      // fallback handling could go here
    } finally {
      setLoadingSession(false);
    }
  }, [mode, language, codeLanguage, duration, wordCount, trustTier, sourceResultId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const submitResult = useCallback(
    async (s: TypingEngineState) => {
      if (!session || submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      setSubmitError(null);
      finalStateRef.current = s;
      try {
        const res = await fetch("/api/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.sessionId,
            integrityToken: session.integrityToken,
            clientElapsedMs: s.elapsedMs,
            metrics: {
              wpm: s.wpm,
              rawWpm: s.rawWpm,
              accuracy: s.accuracy,
              correctChars: s.correctCharacters,
              incorrectChars: s.incorrectCharacters,
              totalChars: s.totalCharacters,
              correctedErrors: s.correctedErrors,
              uncorrectedErrors: s.uncorrectedErrors,
              consistency: s.consistency,
            },
            errorMap: s.keyErrors,
            integritySignals: s.integritySignals,
            ...(trustTier === "CERTIFICATE" &&
              s.eventTrace && { eventTrace: s.eventTrace }),
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.claimToken) {
            sessionStorage.setItem("tf_claim_token", data.claimToken);
          }
          router.push(data.shareUrl);
        } else {
          const errText = await res.text();
          console.error("Result submission failed", errText);
          setSubmitError("Failed to save result. Please try again.");
          submittingRef.current = false;
        }
      } catch (e) {
        console.error(e);
        setSubmitError("Network error. Please try again.");
        submittingRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [session, router, trustTier]
  );

  // ── Engine ────────────────────────────────────────────────────────────────
  const { state, chars, handleKey, handleBackspace } = useTypingEngine({
    passage: session?.passage.content || "",
    mode,
    language: language.toLowerCase() as Language,
    duration: mode === "timed" ? duration : undefined,
    wordCount: mode === "words" ? wordCount : undefined,
    onComplete: submitResult,
  });

  // Intercept the first keypress to start the session on the backend
  const handleKeyWithStart = useCallback(
    (char: string) => {
      if (state.status === "idle" && session && !sessionStarted.current) {
        sessionStarted.current = true;
        fetch("/api/session/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.sessionId,
            integrityToken: session.integrityToken,
          }),
        }).catch(console.error);
      }
      handleKey(char);
    },
    [state.status, session, handleKey]
  );

  const isActive = state.status === "active";
  const isCompleted = state.status === "completed";

  if (loadingSession) {
    return <div className="text-muted py-12 text-center">Loading passage...</div>;
  }

  return (
    <div className={cn("w-full space-y-6", className)}>
      {!isActive && !isCompleted && !hideConfig && (
        <div className="animate-fade-in flex justify-center">
          <TestConfig
            mode={mode}
            duration={duration}
            wordCount={wordCount}
            onModeChange={setMode}
            onDurationChange={setDuration}
            onWordCountChange={setWordCount}
            disabled={isActive}
          />
        </div>
      )}

      {isActive && (
        <div className="animate-fade-in">
          <TypingStats
            wpm={state.wpm}
            accuracy={state.accuracy}
            remainingMs={state.remainingMs}
            elapsedMs={state.elapsedMs}
            mode={mode}
            currentWord={state.currentWordIndex}
            totalWords={mode === "words" ? wordCount : undefined}
            className="justify-center"
          />
        </div>
      )}

      {!isCompleted &&
        session &&
        mode === "practice" &&
        session.passage.sourceAttribution && (
          <div className="border-accent/20 bg-accent/5 mb-4 rounded-xl border p-4 text-center">
            <p className="text-accent text-sm font-medium">
              {session.passage.sourceAttribution.replace(
                "Generated for weak keys:",
                "Focusing on your weakest keys:"
              )}
            </p>
          </div>
        )}

      {!isCompleted && session && (
        <TypingArea
          language={initialLanguage ?? ""}
          chars={chars}
          currentIndex={state.currentIndex}
          errorMap={state.errorMap}
          status={state.status}
          onKey={handleKeyWithStart}
          onBackspace={handleBackspace}
        />
      )}

      {isCompleted && (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="text-muted">
            {submitting ? "Saving result..." : "Test complete."}
          </div>
          {submitError && (
            <div className="text-destructive flex flex-col items-center gap-3">
              <span>{submitError}</span>
              <button
                onClick={() => {
                  if (finalStateRef.current) {
                    submitResult(finalStateRef.current);
                  }
                }}
                className="bg-tf-neutral-800 text-tf-neutral-100 hover:bg-tf-neutral-700 rounded-md px-4 py-2 transition disabled:opacity-50"
                disabled={submitting}
              >
                Retry Submission
              </button>
            </div>
          )}
        </div>
      )}

      {(state.status === "idle" || state.status === "paused") && (
        <div className="flex justify-center">
          <button
            onClick={fetchSession}
            className="text-muted hover:text-tf-neutral-300 text-sm transition-colors"
          >
            ↻ new passage
          </button>
        </div>
      )}
    </div>
  );
}
