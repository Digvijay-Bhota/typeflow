/**
 * TypingStats — live stats bar displayed during and after typing
 *
 * Displays: WPM / Timer / Accuracy
 *
 * Performance: receives pre-computed values from parent,
 * does no calculation itself.
 */
"use client";

import type { FC } from "react";
import { cn, formatMs } from "@/lib/utils";

interface TypingStatsProps {
  wpm: number;
  accuracy: number;
  remainingMs: number | null;
  elapsedMs: number;
  mode: "timed" | "words" | string;
  currentWord: number;
  totalWords?: number | undefined;
  className?: string | undefined;
}

export const TypingStats: FC<TypingStatsProps> = ({
  wpm,
  accuracy,
  remainingMs,
  elapsedMs,
  mode,
  currentWord,
  totalWords,
  className,
}) => {
  const timerLow = mode === "timed" && remainingMs !== null && remainingMs < 10_000;

  return (
    // Same height as the config toolbar it replaces, so starting a test does
    // not shift the passage.
    <div
      className={cn(
        "flex min-h-[46px] flex-wrap items-center justify-between gap-x-8 gap-y-1 text-center",
        className
      )}
    >
      <Stat value={Math.round(wpm)} label="wpm" />

      {/* Timer or progress */}
      {mode === "timed" && remainingMs !== null ? (
        <Stat
          value={formatMs(remainingMs)}
          label="remaining"
          valueClassName={cn(timerLow && "text-danger")}
        />
      ) : mode === "words" && totalWords ? (
        <Stat value={`${currentWord}/${totalWords}`} label="words" />
      ) : (
        <Stat value={formatMs(elapsedMs)} label="elapsed" />
      )}

      <Stat value={`${(accuracy * 100).toFixed(0)}%`} label="accuracy" />
    </div>
  );
};

/**
 * One live value and its unit, e.g. "72 wpm"; tabular digits keep it from
 * jittering. Both inherit the surrounding text colour, so they read on any
 * surface the test sits on (a light card, or the dark code-editor frame).
 */
function Stat({
  value,
  label,
  valueClassName,
}: {
  value: string | number;
  label: string;
  valueClassName?: string | undefined;
}) {
  return (
    <div className="inline-flex min-w-[80px] items-baseline justify-center gap-1.5">
      <span
        className={cn("font-mono text-2xl font-semibold tabular-nums", valueClassName)}
      >
        {value}
      </span>
      <span className="text-xs font-medium tracking-wide uppercase opacity-70">
        {label}
      </span>
    </div>
  );
}
