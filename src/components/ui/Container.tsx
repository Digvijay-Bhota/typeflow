import type { ComponentProps } from "react";
import { cn } from "./cn";

type ContainerProps = ComponentProps<"div"> & {
  /** page: default content width; narrow: reading width. */
  size?: "page" | "narrow";
};

/** Horizontally centred page column with the standard side padding. */
export function Container({ size = "page", className, ...props }: ContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        size === "page" ? "max-w-page" : "max-w-narrow",
        className
      )}
      {...props}
    />
  );
}
