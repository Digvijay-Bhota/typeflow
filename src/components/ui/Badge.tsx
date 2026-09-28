import type { ComponentProps } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

// Tone text on its own 10% tint: checked by tests/unit/designTokens.test.ts.
const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-secondary",
  accent: "bg-accent/10 text-accent",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

type BadgeProps = ComponentProps<"span"> & { tone?: BadgeTone };

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3.5",
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
