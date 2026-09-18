import { FC } from "react";
import { TestResultPublic } from "@/types/typing";

interface CodeMetricsPanelProps {
  result: TestResultPublic;
}

export const CodeMetricsPanel: FC<CodeMetricsPanelProps> = ({ result }) => {
  if (!result.codeMetrics) return null;
  const metrics = result.codeMetrics as any;

  const MetricItem = ({
    label,
    total,
    errors,
    accuracy,
  }: {
    label: string;
    total: number;
    errors: number;
    accuracy: number;
  }) => (
    <div className="bg-tf-background-100 border-border/50 flex flex-col rounded-xl border p-4">
      <div className="text-muted mb-1 text-sm">{label}</div>
      <div className="flex items-end justify-between">
        <span className="text-foreground dark:text-foreground text-2xl font-bold">
          {(accuracy * 100).toFixed(1)}%
        </span>
        <span className="text-muted mb-1 text-xs">
          {errors} err / {total} total
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-4">
      <h3 className="text-foreground dark:text-foreground text-lg font-semibold">
        Code Typing Metrics
      </h3>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricItem
          label="Punctuation"
          total={metrics.totalPunctuation}
          errors={metrics.punctuationErrors}
          accuracy={metrics.punctuationAccuracy}
        />
        <MetricItem
          label="Syntax / Symbols"
          total={metrics.totalSymbols}
          errors={metrics.symbolErrors}
          accuracy={metrics.symbolAccuracy}
        />
        <MetricItem
          label="Indentation"
          total={metrics.totalIndentation}
          errors={metrics.indentationErrors}
          accuracy={metrics.indentationAccuracy}
        />
        <MetricItem
          label="Whitespace"
          total={metrics.totalWhitespace}
          errors={metrics.whitespaceErrors}
          accuracy={metrics.whitespaceAccuracy}
        />
      </div>
    </div>
  );
};
