"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { useTypingEngine } from "../hooks/useTypingEngine";
import { TypingArea } from "./TypingArea";
import { TypingStats } from "./TypingStats";
import { TestConfig } from "./TestConfig";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui";
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
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const sessionStarted = useRef(false);
  const finalStateRef = useRef<TypingEngineState | null>(null);
  // The config stays interactive while a passage loads, so only the latest
  // request may apply its response (a slower, older one is dropped).
  const latestRequest = useRef(0);

  // ── Create Session ───────────────────────────────────────────────────────
  const fetchSession = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoadingSession(true);
    setSessionUnavailable(false);
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
      if (request !== latestRequest.current) return;
      setSession(data);
      sessionStarted.current = false;
      submittingRef.current = false;
      finalStateRef.current = null;
      setSubmitting(false);
    } catch (e) {
      if (request !== latestRequest.current) return;
      console.error(e);
      setSessionUnavailable(true);
    } finally {
      if (request === latestRequest.current) setLoadingSession(false);
    }
  }, [mode, language, codeLanguage, duration, wordCount, trustTier, sourceResultId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  const submitResult = useCallback(
    async (s: TypingEngineState) => {
      if (submittingRef.current) return;
      if (!session) {
        // Never drop a finished test silently — the user would be left on
        // "Test complete." with nothing saved and no way to tell.
        console.error("Result submission failed: no active test session");
        setSubmitError(
          "We couldn't save this result because the test session is missing. Please reload the page and start a new test."
        );
        return;
      }
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
            ...(s.eventTrace && { eventTrace: s.eventTrace }),
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.claimToken && data.shareUrl) {
            const shareId = data.shareUrl.split("/").pop();
            sessionStorage.setItem(`tf_claim_token_${shareId}`, data.claimToken);
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
  const { state, chars, handleKey, handleBackspace, pause, resume } = useTypingEngine({
    sessionId: session?.sessionId,
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

  // Code tests always sit on a dark editor surface (TypingArea forces it), in
  // light and dark themes alike, so text around the passage follows suit.
  const isCode = initialLanguage === "code" || initialLanguage === "CODE";
  // Stands in for the typing area (same height and surface) while a passage
  // loads or cannot be loaded, so the card never jumps.
  const placeholderClass = cn(
    "flex h-[220px] flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center text-sm",
    isCode ? "bg-[#0A0A0A] text-gray-400" : "bg-surface-elevated/30 text-secondary"
  );

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
            currentWord={state.currentWordIndex + 1}
            totalWords={mode === "words" ? wordCount : undefined}
            className={cn("justify-center", isCode && "text-gray-200")}
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

      {!isCompleted && loadingSession && (
        <div role="status" className={placeholderClass}>
          Loading passage…
        </div>
      )}

      {!isCompleted && !loadingSession && sessionUnavailable && (
        <div role="alert" className={placeholderClass}>
          <p>We couldn&apos;t load a passage. Check your connection and try again.</p>
          <button
            type="button"
            onClick={fetchSession}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            <RotateCcw aria-hidden="true" />
            Try again
          </button>
        </div>
      )}

      {!isCompleted && !loadingSession && !sessionUnavailable && session && (
        <TypingArea
          language={initialLanguage ?? ""}
          chars={chars}
          currentIndex={state.currentIndex}
          errorMap={state.errorMap}
          status={state.status}
          onKey={handleKeyWithStart}
          onBackspace={handleBackspace}
          onPause={pause}
          onResume={resume}
        />
      )}

      {isCompleted && (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="text-muted">
            {submitting ? "Saving result..." : "Test complete."}
          </div>
          {submitError && (
            <div className="text-danger flex flex-col items-center gap-3">
              <span>{submitError}</span>
              {finalStateRef.current && (
                <button
                  onClick={() => {
                    if (finalStateRef.current) {
                      submitResult(finalStateRef.current);
                    }
                  }}
                  className={buttonVariants({ variant: "secondary", size: "sm" })}
                  disabled={submitting}
                >
                  Retry Submission
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!isCompleted && !sessionUnavailable && (
        // Kept in the layout while typing (invisible, so not focusable) so
        // the card does not shrink the moment a test starts.
        <div className={cn("flex justify-center", isActive && "invisible")}>
          <button
            type="button"
            onClick={fetchSession}
            disabled={loadingSession || isActive}
            className={buttonVariants({
              variant: "ghost",
              size: "sm",
              className: isCode
                ? "text-gray-400 hover:bg-white/10 hover:text-gray-100"
                : "text-secondary hover:text-foreground",
            })}
          >
            <RotateCcw aria-hidden="true" />
            New passage
          </button>
        </div>
      )}
    </div>
  );
}
