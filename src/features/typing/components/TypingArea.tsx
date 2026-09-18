/**
 * TypingArea — the core typing display component
 *
 * Renders the passage with character-level coloring and a caret.
 *
 * Performance notes:
 * - Uses CSS classes (not inline styles) for character coloring
 * - Caret position computed via DOM measurement, not React layout
 * - No animation library — pure CSS animation
 * - Passage wrapped in a fixed-height container with overflow hidden
 *   to prevent layout shift (no CLS)
 */
"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type FC } from "react";
import { cn } from "@/lib/utils";
import type { ErrorMap, EngineStatus } from "@/types/typing";

interface TypingAreaProps {
  chars: string[];
  currentIndex: number;
  errorMap: ErrorMap;
  status: EngineStatus;
  onKey: (char: string) => void;
  onBackspace: () => void;
  onStart?: () => void;
  className?: string;
}

/** Get CSS class for a character at a given index */
function getCharClass(index: number, currentIndex: number, errorMap: ErrorMap): string {
  if (index >= currentIndex) return "char-pending";

  const error = errorMap[index];
  if (!error) return "char-correct";
  if (error.corrected) return "char-correct"; // corrected errors shown as correct
  return "char-incorrect";
}

export const TypingArea: FC<TypingAreaProps> = ({
  chars,
  currentIndex,
  errorMap,
  status,
  onKey,
  onBackspace,
  onStart,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const charRefsMap = useRef<Map<number, HTMLSpanElement>>(new Map());

  // ── Focus management ──────────────────────────────────────────────────────

  const focusContainer = useCallback(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    // Auto-focus on mount
    focusContainer();
  }, [focusContainer]);

  // ── Caret positioning ─────────────────────────────────────────────────────

  useEffect(() => {
    const caretEl = caretRef.current;
    if (!caretEl) return;

    // Position caret at the current character
    const charEl = charRefsMap.current.get(currentIndex);
    if (charEl) {
      const containerEl = containerRef.current;
      if (!containerEl) return;

      const charRect = charEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();

      const left = charRect.left - containerRect.left + containerEl.scrollLeft;
      const top = charRect.top - containerRect.top + containerEl.scrollTop;

      caretEl.style.left = `${left}px`;
      caretEl.style.top = `${top}px`;
      caretEl.style.height = `${charRect.height}px`;
    } else if (currentIndex >= chars.length) {
      // At end of passage — position after last char
      const lastEl = charRefsMap.current.get(chars.length - 1);
      if (lastEl) {
        const containerEl = containerRef.current;
        if (!containerEl) return;
        const charRect = lastEl.getBoundingClientRect();
        const containerRect = containerEl.getBoundingClientRect();
        const left = charRect.right - containerRect.left + containerEl.scrollLeft;
        const top = charRect.top - containerRect.top + containerEl.scrollTop;
        caretEl.style.left = `${left}px`;
        caretEl.style.top = `${top}px`;
        caretEl.style.height = `${charRect.height}px`;
      }
    }

    // Auto-scroll if caret goes off-screen (for long passages)
    if (containerRef.current && caretEl) {
      const caretTop = parseFloat(caretEl.style.top ?? "0");
      const containerHeight = containerRef.current.clientHeight;
      const scrollTop = containerRef.current.scrollTop;

      if (caretTop > scrollTop + containerHeight - 40) {
        containerRef.current.scrollTo({
          top: caretTop - containerHeight / 2,
          behavior: "smooth",
        });
      }
    }
  }, [currentIndex, chars.length]);

  // ── Keyboard handler ──────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // Prevent default for all typing keys to avoid scroll/browser shortcuts
      const shouldHandle =
        e.key.length === 1 ||
        e.key === "Backspace" ||
        e.key === "Enter" ||
        e.key === "Tab";

      if (!shouldHandle) return;

      // Don't handle modifier combos (Ctrl+C, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      e.preventDefault();

      if (e.key === "Backspace") {
        onBackspace();
        return;
      }

      if (e.key === "Enter") {
        // In code typing, Enter = newline
        onKey("\n");
        return;
      }

      if (e.key === "Tab") {
        onKey("\t");
        return;
      }

      onKey(e.key);

      if (status === "idle") {
        onStart?.();
      }
    },
    [onKey, onBackspace, onStart, status]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const isActive = status === "active" || status === "idle";

  return (
    <div
      ref={containerRef}
      role="textbox"
      aria-label="Typing area — start typing to begin the test"
      aria-live="polite"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={focusContainer}
      className={cn(
        // Base
        "typing-area relative font-mono text-xl leading-relaxed",
        "cursor-text outline-none select-none",
        // Container: fixed height prevents layout shift
        "h-36 overflow-hidden",
        // Visual
        "rounded-lg px-2 py-1",
        // Focus ring
        "focus:ring-accent/40 focus:ring-2",
        // Blur state: dim when not active
        !isActive && "opacity-50",
        className
      )}
    >
      {/* Caret */}
      <span
        ref={caretRef}
        aria-hidden="true"
        className={cn(
          "typing-caret pointer-events-none z-10",
          status === "active" ? "animate-caret-blink" : "opacity-100"
        )}
        style={{ position: "absolute", width: "2px" }}
      />

      {/* Characters */}
      <div className="text-left break-all whitespace-pre-wrap">
        {chars.map((char, i) => {
          const charClass = getCharClass(i, currentIndex, errorMap);

          let displayChar = char;
          if (char === " ") displayChar = "\u00A0";
          else if (char === "\n")
            displayChar = "↵\n"; // visual indicator
          else if (char === "\t") displayChar = "⇥\t"; // visual indicator

          return (
            <span
              key={i}
              ref={(el) => {
                if (el) charRefsMap.current.set(i, el);
                else charRefsMap.current.delete(i);
              }}
              className={cn(
                "relative",
                "inline",
                char === " " ? "text-muted" : "",
                charClass
              )}
              aria-hidden="true"
            >
              {displayChar}
            </span>
          );
        })}
      </div>

      {/* Click-to-focus overlay when idle */}
      {status === "idle" && (
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            "text-muted pointer-events-none text-sm"
          )}
        >
          <span className="bg-surface/80 rounded-md px-3 py-1">
            Click here or start typing
          </span>
        </div>
      )}
    </div>
  );
};
