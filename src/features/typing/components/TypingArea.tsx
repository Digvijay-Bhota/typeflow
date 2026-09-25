"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { nextActiveLineScrollTop } from "../lib/activeLineScroll";
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
  language?: string;
}

function getSyntaxClass(char: string, isCode: boolean): string {
  if (!isCode) return "";
  if (/[{}\[\]()]/.test(char)) return "text-yellow-400/80";
  if (/[=+\-*/<>]/.test(char)) return "text-pink-400/80";
  if (/[;:.,]/.test(char)) return "text-blue-400/80";
  if (/['"`]/.test(char)) return "text-emerald-400/80";
  return "";
}

function getCharClass(
  idx: number,
  currentIdx: number,
  errorMap: ErrorMap,
  char: string,
  isCode: boolean
): string {
  const syntaxClass = getSyntaxClass(char, isCode);

  if (idx === currentIdx) {
    return "text-foreground font-black bg-surface-elevated/50";
  }
  if (idx > currentIdx) {
    return `opacity-70 ${syntaxClass || "text-muted"}`;
  }
  const err = errorMap[idx];
  if (err) {
    if (err.corrected) return "text-orange-400 opacity-90";
    return "text-danger bg-danger/10 border-b-2 border-danger";
  }
  return syntaxClass ? `${syntaxClass} opacity-100` : "text-emerald-500 opacity-100";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function TypingArea({
  chars,
  currentIndex,
  errorMap,
  status,
  onKey,
  onBackspace,
  onStart,
  className,
  language,
}: TypingAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const charRefsMap = useRef<Map<number, HTMLElement>>(new Map());
  const caretRef = useRef<HTMLDivElement>(null);
  const linesContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Where the viewport is, or is smoothly scrolling to. Scroll decisions use
  // this rather than the live scrollTop, which lags behind during a smooth
  // scroll and would otherwise re-trigger or undo it.
  const targetScrollTopRef = useRef(0);

  const isActive = status === "active" || status === "idle";
  const isCode = language === "code" || language === "CODE";

  const lines = useMemo(() => {
    const l: { char: string; index: number }[][] = [];
    let currentLine: { char: string; index: number }[] = [];
    chars.forEach((c, i) => {
      currentLine.push({ char: c, index: i });
      if (c === "\n") {
        l.push(currentLine);
        currentLine = [];
      }
    });
    if (currentLine.length > 0) l.push(currentLine);
    return l;
  }, [chars]);

  /**
   * Draws the caret on the active character and scrolls the viewport so that
   * character stays visible. Everything is measured in the viewport's content
   * coordinates (offset + scrollTop): the caret is positioned inside the
   * scrolled content, so it moves with it, and the scroll target is an
   * absolute offset that does not depend on where a smooth scroll currently is.
   */
  const syncActivePosition = useCallback(() => {
    if (status === "completed") return;
    const viewport = linesContainerRef.current;
    const caret = caretRef.current;
    const currentEl = charRefsMap.current.get(currentIndex);
    if (!viewport || !caret || !currentEl) return;

    const viewportRect = viewport.getBoundingClientRect();
    // First fragment: a character that wraps (e.g. "↵\n") starts on its first line.
    const charRect = currentEl.getClientRects()[0] ?? currentEl.getBoundingClientRect();
    const charLeft = charRect.left - viewportRect.left + viewport.scrollLeft;
    const charTop = charRect.top - viewportRect.top + viewport.scrollTop;

    caret.style.transform = `translate(${charLeft}px, ${charTop}px)`;
    caret.style.height = `${charRect.height}px`;

    // An inline box is shorter than its line box; centre it in the line.
    const lineHeight = Math.max(
      charRect.height,
      parseFloat(getComputedStyle(currentEl).lineHeight) || 0
    );
    const target = nextActiveLineScrollTop({
      lineTop: charTop - (lineHeight - charRect.height) / 2,
      lineHeight,
      scrollTop: targetScrollTopRef.current,
      viewportHeight: viewport.clientHeight,
      maxScrollTop: viewport.scrollHeight - viewport.clientHeight,
    });
    if (target === null) return;

    targetScrollTopRef.current = target;
    viewport.scrollTo({
      top: target,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    // `lines` changes only with a new passage, which re-renders every character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, status, lines]);

  // Before paint, so the caret and viewport never show a stale position. Runs
  // only when the active index or status changes, not on every rerender.
  useLayoutEffect(() => {
    syncActivePosition();
  }, [syncActivePosition]);

  // Layout can also change without typing: window/container resizes, mobile
  // rotation, and the web font swapping in after first paint.
  const syncRef = useRef(syncActivePosition);
  useLayoutEffect(() => {
    syncRef.current = syncActivePosition;
  }, [syncActivePosition]);

  useEffect(() => {
    const resync = () => {
      // A taller viewport lowers the maximum offset and the browser clamps
      // scrollTop to it; keep the remembered target in step.
      const viewport = linesContainerRef.current;
      if (viewport) {
        targetScrollTopRef.current = Math.min(
          targetScrollTopRef.current,
          Math.max(0, viewport.scrollHeight - viewport.clientHeight)
        );
      }
      syncRef.current();
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resync);
    if (linesContainerRef.current) observer?.observe(linesContainerRef.current);
    if (contentRef.current) observer?.observe(contentRef.current);

    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    fonts?.addEventListener?.("loadingdone", resync);
    return () => {
      observer?.disconnect();
      fonts?.removeEventListener?.("loadingdone", resync);
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (status === "completed") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Prevent browser shortcuts kicking in unexpectedly, except specific ones
      if (e.key === "Tab") {
        e.preventDefault();
        if (status === "idle" && onStart) onStart();
        onKey("\t");
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (status === "idle" && onStart) onStart();
        onKey("\n");
        return;
      }

      if (e.key === "Backspace") {
        e.preventDefault();
        onBackspace();
        return;
      }

      if (e.key.length === 1) {
        e.preventDefault();
        if (status === "idle" && onStart) onStart();
        onKey(e.key);
      }
    },
    [status, onStart, onKey, onBackspace]
  );

  const focusContainer = () => {
    containerRef.current?.focus();
  };

  return (
    <div
      ref={containerRef}
      role="textbox"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={focusContainer}
      className={cn(
        "relative cursor-text font-mono text-xl leading-relaxed outline-none select-none md:text-2xl",
        "h-[220px] overflow-hidden rounded-2xl p-6 transition-all",
        "focus:ring-accent/40 focus:ring-2",
        !isActive && "opacity-60",
        isCode ? "bg-[#0A0A0A] text-gray-300" : "bg-surface-elevated/30",
        className
      )}
    >
      {status === "idle" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="bg-background/90 text-foreground border-border animate-pulse rounded-xl border px-4 py-2 font-bold shadow-sm">
            Click to start typing
          </span>
        </div>
      )}

      <div
        ref={linesContainerRef}
        data-testid="typing-viewport"
        className="relative h-full w-full overflow-hidden"
      >
        <div
          ref={caretRef}
          className={cn(
            "bg-accent absolute top-0 left-0 z-20 w-[3px] rounded-full transition-all duration-75 ease-out",
            isActive ? "animate-caret-pulse" : "hidden"
          )}
        />

        {/* Wrap at spaces, not mid-word: spaces are real (break-spaces keeps
            each one visible and caret-sized at a line end, never hanging past
            the edge), and only a token longer than a line is broken. */}
        <div
          ref={contentRef}
          className="flex flex-col pb-20 text-left wrap-break-word whitespace-break-spaces"
        >
          {lines.map((line, lineIdx) => (
            <div key={lineIdx} className="group flex">
              {isCode && (
                <div className="w-12 shrink-0 pt-1 pr-4 text-right font-mono text-sm text-zinc-700 select-none">
                  {lineIdx + 1}
                </div>
              )}
              <div className="flex-1">
                {line.map(({ char, index }) => {
                  const charClass = getCharClass(
                    index,
                    currentIndex,
                    errorMap,
                    char,
                    isCode
                  );
                  let displayChar = char;
                  if (char === "\n") displayChar = isCode ? "↵\n" : "\n";
                  else if (char === "\t") displayChar = "⇥\t";

                  return (
                    <span
                      key={index}
                      ref={(el) => {
                        if (el) charRefsMap.current.set(index, el);
                        else charRefsMap.current.delete(index);
                      }}
                      className={cn("relative inline", charClass)}
                    >
                      {displayChar}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
