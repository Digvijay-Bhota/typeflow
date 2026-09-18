import React from "react";
import { TestResultPublic } from "@/types/typing";

interface AccuracyPanelProps {
  result: TestResultPublic;
}

export function AccuracyPanel({ result }: AccuracyPanelProps) {
  return (
    <div className="bg-background dark:bg-background border border-border dark:border-border rounded-2xl p-6">
      <h3 className="text-lg font-semibold mb-4 text-foreground dark:text-foreground">Accuracy Breakdown</h3>
      
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="flex flex-col">
          <span className="text-xs text-muted uppercase">Correct</span>
          <span className="text-2xl font-bold text-green-600 dark:text-green-500">{result.correctChars}</span>
        </div>
        
        <div className="flex flex-col">
          <span className="text-xs text-muted uppercase">Incorrect</span>
          <span className="text-2xl font-bold text-red-600 dark:text-red-500">{result.incorrectChars}</span>
        </div>
        
        <div className="flex flex-col">
          <span className="text-xs text-muted uppercase">Corrected</span>
          <span className="text-2xl font-bold text-yellow-600 dark:text-yellow-500">{result.correctedErrors}</span>
        </div>
        
        <div className="flex flex-col">
          <span className="text-xs text-muted uppercase">Uncorrected</span>
          <span className="text-2xl font-bold text-orange-600 dark:text-orange-500">{result.uncorrectedErrors}</span>
        </div>
      </div>

      <div className="mt-6 flex justify-between text-sm text-muted border-t border-border dark:border-border pt-4">
        <span>Raw WPM: {Math.round(result.rawWpm)}</span>
        <span>Net WPM: {Math.round(result.netWpm)}</span>
        <span>Total Characters: {result.totalChars}</span>
      </div>
    </div>
  );
}
