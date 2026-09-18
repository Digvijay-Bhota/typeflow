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
  codeLanguage,
  duration: initialDuration,
  wordCount: initialWordCount,
  trustTier: initialTrustTier,
  hideConfig,
}: {
  className?: string;
  mode?: TypingMode | undefined;
  language?: string | undefined;
  codeLanguage?: string | undefined;
  duration?: number | undefined;
  wordCount?: number | undefined;
  trustTier?: string | undefined;
  hideConfig?: boolean | undefined;
}) {
  const router = useRouter();

  // ── Config state ─────────────────────────────────────────────────────────
  const [mode, setMode] = useState<TypingMode>(initialMode || "timed");
  const [duration, setDuration] = useState<TestDuration>(
    (initialDuration as TestDuration) || DEFAULT_DURATION
  );
  const [wordCount, setWordCount] = useState<WordCount>(
    (initialWordCount as WordCount) || DEFAULT_WORD_COUNT
  );
  const language = initialLanguage || "english";
  const trustTier = initialTrustTier || "FREE";

  // ── Backend Session state ────────────────────────────────────────────────
  const [session, setSession] = useState<SessionInitResponse | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const sessionStarted = useRef(false);

  // ── Create Session ───────────────────────────────────────────────────────
  const fetchSession = useCallback(async () => {
    setLoadingSession(true);
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
        }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const data = await res.json();
      setSession(data);
      sessionStarted.current = false;
      submittingRef.current = false;
      setSubmitting(false);
    } catch (e) {
      console.error(e);
      // fallback handling could go here
    } finally {
      setLoadingSession(false);
    }
  }, [mode, duration, wordCount, language, codeLanguage, trustTier]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // ── Engine ────────────────────────────────────────────────────────────────
  const { state, chars, handleKey, handleBackspace } = useTypingEngine({
    passage: session?.passage.content || "",
    mode,
    language: language.toLowerCase() as Language,
    duration: mode === "timed" ? duration : undefined,
    wordCount: mode === "words" ? wordCount : undefined,
    onComplete: useCallback(
      async (s: TypingEngineState) => {
        if (!session || submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        try {
          const res = await fetch("/api/result", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: session.sessionId,
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
            console.error("Result submission failed", await res.text());
          }
        } catch (e) {
          console.error(e);
        } finally {
          setSubmitting(false);
        }
      },
      [session, router, trustTier]
    ),
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

      {!isCompleted && session && (
        <TypingArea
          chars={chars}
          currentIndex={state.currentIndex}
          errorMap={state.errorMap}
          status={state.status}
          onKey={handleKeyWithStart}
          onBackspace={handleBackspace}
        />
      )}

      {isCompleted && (
        <div className="text-muted py-12 text-center">
          {submitting ? "Saving result..." : "Test complete."}
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
