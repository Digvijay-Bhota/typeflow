import Link from "next/link";
import { useId } from "react";
import { cn } from "@/components/ui";

export type FilterOption = { label: string; href: string; current: boolean };

/**
 * A labelled row of filter links (segmented look). Links, not buttons: each
 * filter is a URL the server renders, so it works without JavaScript and can be
 * bookmarked. The selected option is marked aria-current.
 */
export function FilterBar({
  label,
  options,
}: {
  label: string;
  options: FilterOption[];
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-muted text-xs font-medium">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="rounded-control bg-surface-muted inline-flex w-fit max-w-full flex-wrap gap-1 p-1"
      >
        {options.map((option) => (
          <Link
            key={option.href}
            href={option.href}
            scroll={false}
            aria-current={option.current ? "true" : undefined}
            className={cn(
              "text-secondary hover:text-foreground inline-flex h-9 items-center rounded-[calc(var(--radius-control)-0.25rem)] px-3 text-sm font-medium transition-colors duration-(--duration-fast)",
              option.current && "bg-surface-elevated text-foreground shadow-card"
            )}
          >
            {option.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
