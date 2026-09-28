import { ArrowRight, Keyboard } from "lucide-react";
import { ButtonLink, Card } from "@/components/ui";

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
    <Card className="flex w-full flex-col items-center px-6 py-12 text-center sm:px-12">
      <div
        aria-hidden="true"
        className="rounded-card bg-accent-soft text-accent mb-6 flex size-14 items-center justify-center [&_svg]:size-7"
      >
        {icon || <Keyboard />}
      </div>
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-secondary mt-2 max-w-md leading-relaxed">{description}</p>
      {actionHref && (
        <ButtonLink href={actionHref} size="lg" className="group mt-8">
          {actionText}
          <ArrowRight
            aria-hidden="true"
            className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </ButtonLink>
      )}
    </Card>
  );
}
