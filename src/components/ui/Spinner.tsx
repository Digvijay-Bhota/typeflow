import { Loader2 } from "lucide-react";
import { cn } from "./cn";
import { VisuallyHidden } from "./VisuallyHidden";

type SpinnerProps = {
  /** Announced to screen readers; omit when nearby text already says what is loading. */
  label?: string;
  className?: string;
};

/** Indeterminate progress. Stops spinning under prefers-reduced-motion. */
export function Spinner({ label, className }: SpinnerProps) {
  const icon = (
    <Loader2
      aria-hidden="true"
      className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
    />
  );
  if (!label) return icon;
  return (
    <span role="status" className="inline-flex items-center">
      {icon}
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
