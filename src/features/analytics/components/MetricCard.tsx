import React from "react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  subValue?: string | undefined;
  highlight?: boolean;
  className?: string;
}

export function MetricCard({ label, value, subValue, highlight, className }: MetricCardProps) {
  return (
    <div className={cn(
      "flex flex-col p-6 rounded-2xl border",
      highlight 
        ? "bg-accent/10 border-tf-primary-500/20" 
        : "bg-background dark:bg-background border-border dark:border-border",
      className
    )}>
      <span className={cn(
        "text-sm uppercase tracking-wider mb-2",
        highlight ? "text-accent dark:text-accent" : "text-muted"
      )}>
        {label}
      </span>
      <span className={cn(
        "text-4xl sm:text-5xl font-black",
        highlight ? "text-accent dark:text-accent" : "text-foreground dark:text-foreground"
      )}>
        {value}
      </span>
      {subValue && (
        <span className="text-sm text-muted mt-2">
          {subValue}
        </span>
      )}
    </div>
  );
}
