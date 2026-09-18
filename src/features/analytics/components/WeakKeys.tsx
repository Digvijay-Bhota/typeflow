import React from "react";

interface WeakKeysProps {
  errorMap: Record<string, { expected: string; count: number; corrected: number; uncorrected: number }> | null;
}

export function WeakKeys({ errorMap }: WeakKeysProps) {
  if (!errorMap || Object.keys(errorMap).length === 0) {
    return (
      <div className="bg-background dark:bg-background border border-border dark:border-border rounded-2xl p-6 flex flex-col items-center justify-center min-h-[200px] text-muted">
        <h3 className="text-lg font-semibold mb-2">Session Error Analysis</h3>
        <p>No errors recorded in this session. Perfect typing!</p>
      </div>
    );
  }

  // Backward compatibility check for Phase 2 legacy errorMaps (which used positional indices without 'count')
  const hasValidFormat = Object.values(errorMap).every(v => typeof v.count === "number");
  if (!hasValidFormat) {
    return (
      <div className="bg-background dark:bg-background border border-border dark:border-border rounded-2xl p-6 flex flex-col items-center justify-center min-h-[200px] text-muted">
        <h3 className="text-lg font-semibold mb-2">Session Error Analysis</h3>
        <p>Detailed error analysis is not available for this older result.</p>
      </div>
    );
  }

  // Sort by count descending
  const sortedKeys = Object.values(errorMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10); // Top 10 worst keys

  return (
    <div className="bg-background dark:bg-background border border-border dark:border-border rounded-2xl p-6">
      <h3 className="text-lg font-semibold mb-4 text-foreground dark:text-foreground">Session Error Analysis</h3>
      
      <div className="space-y-4">
        {sortedKeys.map((k) => (
          <div key={k.expected} className="flex items-center justify-between p-3 bg-surface dark:bg-surface rounded-lg border border-border dark:border-border">
            <div className="flex items-center gap-4">
              <span className="w-10 h-10 flex items-center justify-center bg-tf-text-100 dark:bg-tf-text-800 rounded font-mono font-bold text-foreground dark:text-foreground">
                {k.expected === " " ? "␣" : k.expected}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{k.count} {k.count === 1 ? "error" : "errors"}</span>
                <span className="text-xs text-muted">{k.corrected} corrected, {k.uncorrected} missed</span>
              </div>
            </div>
            
            <div className="w-24 h-2 bg-tf-text-100 dark:bg-tf-text-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-red-500" 
                style={{ width: `${Math.min(100, (k.count / (sortedKeys[0]?.count ?? 1)) * 100)}%` }} 
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
