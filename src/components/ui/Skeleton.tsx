import type { ComponentProps } from "react";
import { cn } from "./cn";

/**
 * Placeholder shape while content loads. Hidden from assistive technology:
 * announce loading once, on the region, not per shape.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        // A foreground tint stays visible on any surface in both themes.
        "rounded-control bg-foreground/10 animate-pulse motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  );
}
