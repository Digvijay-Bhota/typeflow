import React from "react";

const KEYBOARD_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/"],
  [" "],
];

interface KeyboardHeatmapProps {
  errorMap: Record<
    string,
    { expected: string; count: number; corrected: number; uncorrected: number }
  > | null;
}

export function KeyboardHeatmap({ errorMap }: KeyboardHeatmapProps) {
  if (!errorMap || Object.keys(errorMap).length === 0) {
    return (
      <div className="border-border bg-background/50 flex h-[200px] items-center justify-center rounded-2xl border border-dashed">
        <p className="text-muted text-sm font-bold">No key data available</p>
      </div>
    );
  }

  // Find max error count to scale colors
  let maxCount = 0;
  let topKey = "";
  Object.values(errorMap).forEach((val) => {
    if (val.count > maxCount) {
      maxCount = val.count;
      topKey = val.expected === " " ? "Space" : val.expected;
    }
  });

  return (
    <div
      className="border-border bg-surface flex flex-col gap-2 overflow-x-auto rounded-2xl border p-6 shadow-sm"
      role="region"
      aria-label="Keyboard Error Heatmap"
    >
      <div className="sr-only">
        Keyboard error heatmap. Your weakest key was {topKey} with {maxCount} misses.
      </div>
      <div className="mx-auto flex min-w-[600px] flex-col gap-1.5">
        {KEYBOARD_ROWS.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className={`flex justify-center gap-1.5 ${
              rowIndex === 1 ? "ml-4" : rowIndex === 2 ? "ml-10" : ""
            }`}
          >
            {row.map((key) => {
              const errorData = errorMap[key];
              const isSpace = key === " ";
              return (
                <div
                  key={key}
                  className={`border-border relative flex items-center justify-center rounded-lg border transition-colors ${isSpace ? "h-10 w-64" : "h-10 w-10 sm:h-12 sm:w-12"} ${!errorData ? "bg-background" : ""} `}
                  title={errorData ? `${errorData.count} misses` : "0 misses"}
                  role="img"
                  aria-label={`Key ${isSpace ? "Space" : key}, ${
                    errorData ? errorData.count : 0
                  } misses`}
                >
                  <span className="font-mono text-sm uppercase">
                    {isSpace ? "SPACE" : key}
                  </span>
                  {errorData && errorData.count > 0 && (
                    <span className="bg-danger absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-black text-white shadow-sm">
                      {errorData.count}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="text-muted mt-4 flex items-center justify-center gap-4 text-xs font-medium">
        <span className="flex items-center gap-2">
          <div className="border-border bg-background h-3 w-3 rounded-sm border"></div>0
          misses
        </span>
        <span className="flex items-center gap-2">
          <div className="bg-danger/30 h-3 w-3 rounded-sm"></div>
          Few misses
        </span>
        <span className="flex items-center gap-2">
          <div className="bg-danger/80 h-3 w-3 rounded-sm"></div>
          Many misses
        </span>
      </div>
    </div>
  );
}
