import React from "react";
import Link from "next/link";
import { Keyboard, ArrowRight } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description: string;
  actionText?: string;
  actionHref?: string;
  icon?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  actionText = "Start Typing Test",
  actionHref = "/",
  icon,
}: EmptyStateProps) {
  return (
    <div className="bg-surface border-border flex w-full flex-col items-center justify-center rounded-2xl border p-12 text-center shadow-sm">
      <div className="bg-accent/10 text-accent mb-6 flex h-16 w-16 items-center justify-center rounded-2xl">
        {icon || <Keyboard className="h-8 w-8" />}
      </div>
      <h2 className="text-foreground mb-2 text-2xl font-bold">{title}</h2>
      <p className="text-muted mb-8 max-w-md text-base leading-relaxed">{description}</p>
      {actionHref && (
        <Link
          href={actionHref}
          className="bg-accent text-accent-foreground hover:bg-accent/90 group flex items-center gap-2 rounded-xl px-6 py-3 font-medium transition-all"
        >
          {actionText}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>
      )}
    </div>
  );
}
