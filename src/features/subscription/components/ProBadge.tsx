import React from "react";
import { cn } from "@/lib/utils";

interface ProBadgeProps {
  className?: string;
  size?: "sm" | "md";
}

/**
 * Pro badge displayed next to user name / feature headers.
 * Purely visual — feature access is always verified server-side.
 */
export function ProBadge({ className, size = "sm" }: ProBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-bold",
        "bg-tf-primary-100 dark:bg-tf-primary-900",
        "text-tf-primary-700 dark:text-tf-primary-300",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
        className
      )}
    >
      PRO
    </span>
  );
}
