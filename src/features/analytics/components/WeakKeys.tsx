import React from "react";

interface WeakKeysProps {
  errorMap: Record<
    string,
    { expected: string; count: number; corrected: number; uncorrected: number }
  > | null;
}

export function WeakKeys({ errorMap }: WeakKeysProps) {
  if (!errorMap || Object.keys(errorMap).length === 0) {
    return (
      <div className="bg-background dark:bg-background border-border dark:border-border text-muted flex min-h-[200px] flex-col items-center justify-center rounded-2xl border p-6">
        <h3 className="mb-2 text-lg font-semibold">Session Error Analysis</h3>
        <p>No errors recorded in this session. Perfect typing!</p>
      </div>
    );
  }

  // Backward compatibility check for Phase 2 legacy errorMaps (which used positional indices without 'count')
  const hasValidFormat = Object.values(errorMap).every(
    (v) => typeof v.count === "number"
  );
  if (!hasValidFormat) {
    return (
      <div className="bg-background dark:bg-background border-border dark:border-border text-muted flex min-h-[200px] flex-col items-center justify-center rounded-2xl border p-6">
        <h3 className="mb-2 text-lg font-semibold">Session Error Analysis</h3>
        <p>Detailed error analysis is not available for this older result.</p>
      </div>
    );
  }

  // Sort by count descending
  const sortedKeys = Object.values(errorMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Top 10 worst keys

  return (
    <div className="bg-background dark:bg-background border-border dark:border-border rounded-2xl border p-6">
      <h3 className="text-foreground dark:text-foreground mb-4 text-lg font-semibold">
        Session Error Analysis
      </h3>

      <div className="space-y-4">
        {sortedKeys.map((k) => (
          <div
            key={k.expected}
            className="bg-surface dark:bg-surface border-border dark:border-border flex items-center justify-between rounded-lg border p-3"
          >
            <div className="flex items-center gap-4">
              <span className="bg-tf-text-100 dark:bg-tf-text-800 text-foreground dark:text-foreground flex h-10 w-10 items-center justify-center rounded font-mono font-bold">
                {k.expected === " " ? "␣" : k.expected}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {k.count} {k.count === 1 ? "error" : "errors"}
                </span>
                <span className="text-muted text-xs">
                  {k.corrected} corrected, {k.uncorrected} missed
                </span>
              </div>
            </div>

            <div className="bg-tf-text-100 dark:bg-tf-text-800 h-2 w-24 overflow-hidden rounded-full">
              <div
                className="h-full bg-red-500"
                style={{
                  width: `${Math.min(100, (k.count / (sortedKeys[0]?.count ?? 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
