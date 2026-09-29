"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

const OPTIONS: Record<"datetime" | "date", Intl.DateTimeFormatOptions> = {
  datetime: { dateStyle: "medium", timeStyle: "short" },
  date: { dateStyle: "medium" },
};

/**
 * A timestamp in the viewer's own time zone and locale. The server cannot know
 * those, so it renders UTC (labelled as such); the browser switches to local
 * time right after hydration. Both passes agree on the first render, so there
 * is no hydration mismatch.
 */
export function LocalDateTime({
  value,
  format = "datetime",
}: {
  /** ISO timestamp. */
  value: string;
  format?: "datetime" | "date";
}) {
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const date = new Date(value);
  const text = isClient
    ? date.toLocaleString(undefined, OPTIONS[format])
    : `${date.toLocaleString("en-US", { ...OPTIONS[format], timeZone: "UTC" })}${
        format === "datetime" ? " UTC" : ""
      }`;

  return <time dateTime={value}>{text}</time>;
}
