import React from "react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  subValue?: string | undefined;
  highlight?: boolean;
  className?: string;
}

export function MetricCard({
  label,
  value,
  subValue,
  highlight,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border p-6",
        highlight
          ? "bg-accent/10 border-tf-primary-500/20"
          : "bg-background dark:bg-background border-border dark:border-border",
        className
      )}
    >
      <span
        className={cn(
          "mb-2 text-sm tracking-wider uppercase",
          highlight ? "text-accent dark:text-accent" : "text-muted"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-4xl font-black sm:text-5xl",
          highlight
            ? "text-accent dark:text-accent"
            : "text-foreground dark:text-foreground"
        )}
      >
        {value}
      </span>
      {subValue && <span className="text-muted mt-2 text-sm">{subValue}</span>}
    </div>
  );
}
