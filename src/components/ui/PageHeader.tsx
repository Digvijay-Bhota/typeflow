import type { ReactNode } from "react";
import { cn } from "./cn";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or links shown beside the title (below it on small screens). */
  actions?: ReactNode;
  className?: string;
};

/** The page's single <h1>, with an optional description and actions. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-semibold">{title}</h1>
        {description && <p className="text-secondary max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}
