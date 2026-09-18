import React from "react";
import { MetricCard } from "./MetricCard";
import { formatWpm, formatAccuracy, formatDuration, formatConsistency } from "../lib/formatMetrics";
import { TestResultPublic } from "@/types/typing";

interface ResultSummaryProps {
  result: TestResultPublic;
}

export function ResultSummary({ result }: ResultSummaryProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
      <MetricCard
        label="WPM"
        value={formatWpm(result.wpm)}
        subValue={result.mode === "TIMED" ? `Duration: ${formatDuration(result.elapsedMs)}` : undefined}
        highlight
      />
      <MetricCard
        label="Accuracy"
        value={formatAccuracy(result.accuracy)}
      />
      <MetricCard
        label="Consistency"
        value={formatConsistency(result.consistency)}
      />
      <MetricCard
        label="Duration"
        value={formatDuration(result.elapsedMs)}
        subValue={`${result.mode.toLowerCase()} mode`}
      />
    </div>
  );
}
