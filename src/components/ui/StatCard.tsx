import type { ReactNode } from "react";
import { Card } from "./Card";
import { cn } from "./cn";

type StatCardProps = {
  label: ReactNode;
  value: ReactNode;
  /** Short context under the value (e.g. "best of 12 tests"). */
  hint?: ReactNode;
  /** A lucide icon; decorative. */
  icon?: ReactNode;
  className?: string;
};

/** One metric. Label and value are a description list, so they are read together. */
export function StatCard({ label, value, hint, icon, className }: StatCardProps) {
  return (
    <Card className={cn("p-5", className)}>
      <dl className="flex flex-col gap-1">
        <dt className="text-secondary flex items-center gap-2 text-sm font-medium [&_svg]:size-4">
          {icon && <span aria-hidden="true">{icon}</span>}
          {label}
        </dt>
        <dd className="text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
        {hint && <dd className="text-muted text-sm">{hint}</dd>}
      </dl>
    </Card>
  );
}
