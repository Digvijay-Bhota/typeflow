import { FC } from "react";
import { TestResultPublic } from "@/types/typing";

interface CodeMetricsPanelProps {
  result: TestResultPublic;
}

export const CodeMetricsPanel: FC<CodeMetricsPanelProps> = ({ result }) => {
  if (!result.codeMetrics) return null;
  const metrics = result.codeMetrics as any;

  const MetricItem = ({ label, total, errors, accuracy }: { label: string, total: number, errors: number, accuracy: number }) => (
    <div className="flex flex-col bg-tf-background-100 p-4 rounded-xl border border-border/50">
      <div className="text-sm text-muted mb-1">{label}</div>
      <div className="flex justify-between items-end">
        <span className="text-2xl font-bold text-foreground dark:text-foreground">
          {(accuracy * 100).toFixed(1)}%
        </span>
        <span className="text-xs text-muted mb-1">
          {errors} err / {total} total
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 w-full">
      <h3 className="text-lg font-semibold text-foreground dark:text-foreground">Code Typing Metrics</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricItem label="Punctuation" total={metrics.totalPunctuation} errors={metrics.punctuationErrors} accuracy={metrics.punctuationAccuracy} />
        <MetricItem label="Syntax / Symbols" total={metrics.totalSymbols} errors={metrics.symbolErrors} accuracy={metrics.symbolAccuracy} />
        <MetricItem label="Indentation" total={metrics.totalIndentation} errors={metrics.indentationErrors} accuracy={metrics.indentationAccuracy} />
        <MetricItem label="Whitespace" total={metrics.totalWhitespace} errors={metrics.whitespaceErrors} accuracy={metrics.whitespaceAccuracy} />
      </div>
    </div>
  );
};
