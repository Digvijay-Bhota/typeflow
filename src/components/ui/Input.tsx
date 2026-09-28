import type { ComponentProps } from "react";
import { cn } from "./cn";

// Control boundary uses border-strong (≥ 3:1); invalid state follows aria-invalid.
const control =
  "w-full rounded-control border border-border-strong bg-surface text-sm text-foreground " +
  "placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-invalid:border-danger read-only:bg-surface-muted";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return <input type={type} className={cn(control, "h-10 px-3", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 px-3 py-2", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label className={cn("text-foreground text-sm font-medium", className)} {...props} />
  );
}
