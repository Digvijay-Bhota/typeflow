import type { ComponentProps } from "react";
import { cn } from "./cn";

type ContainerProps = ComponentProps<"div"> & {
  /** wide: app shell and dashboards; page: default content; narrow: reading width. */
  size?: "wide" | "page" | "narrow";
};

/** Horizontally centred page column with the standard side padding. */
export function Container({ size = "page", className, ...props }: ContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        { wide: "max-w-wide", page: "max-w-page", narrow: "max-w-narrow" }[size],
        className
      )}
      {...props}
    />
  );
}
