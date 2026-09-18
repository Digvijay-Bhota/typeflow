/**
 * TestConfig — typing test configuration bar
 *
 * Allows users to select:
 * - Mode (timed / words)
 * - Duration (15s / 30s / 1m / 2m / 3m / 5m)
 * - Word count (10 / 25 / 50 / 100 / 200)
 * - Language (English / Code)
 */
"use client";

import type { FC } from "react";
import { cn } from "@/lib/utils";
import { TEST_DURATIONS, WORD_COUNTS } from "@/lib/constants";
import { Timer, Type } from "lucide-react";
import type { TypingMode, TestDuration, WordCount } from "@/lib/constants";

interface TestConfigProps {
  mode: TypingMode;
  duration: TestDuration;
  wordCount: WordCount;
  onModeChange: (mode: TypingMode) => void;
  onDurationChange: (duration: TestDuration) => void;
  onWordCountChange: (count: WordCount) => void;
  disabled?: boolean;
  className?: string;
}

interface ConfigButtonProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean | undefined;
  children: React.ReactNode;
}

const ConfigButton: FC<ConfigButtonProps> = ({ active, onClick, disabled, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
      "focus-visible:ring-accent focus:outline-none focus-visible:ring-2",
      active
        ? "bg-accent/10 text-accent border-accent/20 border shadow-sm"
        : "text-muted hover:text-foreground hover:bg-surface-elevated border border-transparent",
      disabled && "cursor-not-allowed opacity-40"
    )}
  >
    {children}
  </button>
);

const Divider = () => (
  <span className="text-border bg-border mx-2 h-6 w-px select-none" />
);

export const TestConfig: FC<TestConfigProps> = ({
  mode,
  duration,
  wordCount,
  onModeChange,
  onDurationChange,
  onWordCountChange,
  disabled,
}) => {
  const isTimed = mode === "timed";
  const isWords = mode === "words";

  const durationLabel = (s: TestDuration): string => {
    if (s < 60) return `${s}s`;
    return `${s / 60}m`;
  };

  return (
    <div
      className={cn(
        "bg-surface/50 border-border/50 flex flex-wrap items-center gap-1 rounded-xl border p-1.5 backdrop-blur-sm",
        "text-muted text-sm shadow-sm"
      )}
      role="toolbar"
      aria-label="Test configuration"
    >
      {/* Mode selection */}
      <ConfigButton
        active={isTimed}
        onClick={() => onModeChange("timed")}
        disabled={disabled}
      >
        <Timer className="h-4 w-4" /> Timed
      </ConfigButton>
      <ConfigButton
        active={isWords}
        onClick={() => onModeChange("words")}
        disabled={disabled}
      >
        <Type className="h-4 w-4" /> Words
      </ConfigButton>

      <Divider />

      {/* Duration buttons — only shown in timed mode */}
      {isTimed &&
        TEST_DURATIONS.map((d) => (
          <ConfigButton
            key={d}
            active={duration === d}
            onClick={() => onDurationChange(d)}
            disabled={disabled}
          >
            {durationLabel(d)}
          </ConfigButton>
        ))}

      {/* Word count buttons — only shown in words mode */}
      {isWords &&
        WORD_COUNTS.map((wc) => (
          <ConfigButton
            key={wc}
            active={wordCount === wc}
            onClick={() => onWordCountChange(wc)}
            disabled={disabled}
          >
            {wc}
          </ConfigButton>
        ))}
    </div>
  );
};
