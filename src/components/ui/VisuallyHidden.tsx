import type { ComponentProps } from "react";
import { cn } from "./cn";

/** Text for assistive technology only (screen readers), hidden visually. */
export function VisuallyHidden({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("sr-only", className)} {...props} />;
}
