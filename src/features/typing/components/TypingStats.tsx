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
  return (
    <div className={cn("flex items-center justify-between gap-6 text-center", className)}>
      {/* WPM */}
      <div className="stat-badge min-w-[80px]">
        <span className="stat-badge__value">{Math.round(wpm)}</span>
        <span className="stat-badge__label">wpm</span>
      </div>

      {/* Timer or progress */}
      <div className="stat-badge min-w-[80px]">
        {mode === "timed" && remainingMs !== null ? (
          <>
            <span
              className={cn("stat-badge__value", remainingMs < 10_000 && "text-red-400")}
            >
              {formatMs(remainingMs)}
            </span>
            <span className="stat-badge__label">remaining</span>
          </>
        ) : mode === "words" && totalWords ? (
          <>
            <span className="stat-badge__value">
              {currentWord}/{totalWords}
            </span>
            <span className="stat-badge__label">words</span>
          </>
        ) : (
          <>
            <span className="stat-badge__value">{formatMs(elapsedMs)}</span>
            <span className="stat-badge__label">elapsed</span>
          </>
        )}
      </div>

      {/* Accuracy */}
      <div className="stat-badge min-w-[80px]">
        <span className="stat-badge__value">{(accuracy * 100).toFixed(0)}%</span>
        <span className="stat-badge__label">accuracy</span>
      </div>
    </div>
  );
};
