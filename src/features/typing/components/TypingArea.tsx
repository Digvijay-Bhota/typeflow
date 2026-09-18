"use client";

import { useCallback, useEffect, useRef, useMemo, type KeyboardEvent } from "react";
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
  language?: string;
}

function getCharClass(idx: number, currentIdx: number, errorMap: ErrorMap): string {
  if (idx === currentIdx) {
    return "text-foreground font-black";
  }
  if (idx > currentIdx) {
    return "text-muted opacity-70";
  }
  const err = errorMap[idx];
  if (err) {
    if (err.corrected) return "text-orange-400 opacity-90";
    return "text-danger bg-danger/10 border-b-2 border-danger";
  }
  return "text-emerald-500 opacity-100";
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

  const updateCaret = useCallback(() => {
    if (status === "completed") return;
    const currentEl = charRefsMap.current.get(currentIndex);
    if (!currentEl || !caretRef.current || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const charRect = currentEl.getBoundingClientRect();

    const caretX = charRect.left - containerRect.left;
    const caretY = charRect.top - containerRect.top;

    caretRef.current.style.transform = `translate(${caretX}px, ${caretY}px)`;
    caretRef.current.style.height = `${charRect.height}px`;

    // Smooth scroll if needed
    if (linesContainerRef.current) {
      const scrollTarget = caretY - containerRect.height / 2 + charRect.height / 2;
      if (Math.abs(linesContainerRef.current.scrollTop - scrollTarget) > 20) {
        linesContainerRef.current.scrollTo({
          top: Math.max(0, scrollTarget),
          behavior: "smooth",
        });
      }
    }
  }, [currentIndex, status]);

  useEffect(() => {
    const af = requestAnimationFrame(updateCaret);
    return () => cancelAnimationFrame(af);
  }, [updateCaret]);

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

      <div ref={linesContainerRef} className="relative h-full w-full overflow-hidden">
        <div
          ref={caretRef}
          className={cn(
            "bg-accent absolute top-0 left-0 z-20 w-[3px] rounded-full transition-all duration-75 ease-out",
            isActive ? "animate-caret-pulse" : "hidden"
          )}
        />

        <div className="flex flex-col pb-20 text-left break-all whitespace-pre-wrap">
          {lines.map((line, lineIdx) => (
            <div key={lineIdx} className="group flex">
              {isCode && (
                <div className="w-12 shrink-0 pt-1 pr-4 text-right font-mono text-sm text-zinc-700 select-none">
                  {lineIdx + 1}
                </div>
              )}
              <div className="flex-1">
                {line.map(({ char, index }) => {
                  const charClass = getCharClass(index, currentIndex, errorMap);
                  let displayChar = char;
                  if (char === " ") displayChar = "\u00A0";
                  else if (char === "\n") displayChar = isCode ? "↵\n" : "\n";
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
