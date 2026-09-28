"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, ButtonLink, Container } from "@/components/ui";

// Rendered inside the root layout's <main>: no <main> of its own.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to monitoring service (Sentry integration — Phase 12)
    console.error("Unhandled app error:", error.message);
  }, [error]);

  return (
    <Container
      size="narrow"
      className="flex flex-1 flex-col items-center justify-center py-24 text-center"
    >
      <div
        aria-hidden="true"
        className="bg-danger/10 text-danger rounded-card flex size-14 items-center justify-center"
      >
        <AlertTriangle className="size-7" />
      </div>
      <h1 className="text-title mt-6 font-semibold">Something went wrong</h1>
      <p className="text-secondary mt-3">
        An unexpected error occurred. Your typing data has not been lost.
      </p>
      {error.digest && (
        <p className="text-muted mt-2 font-mono text-xs">Error ID: {error.digest}</p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <ButtonLink href="/" variant="secondary" size="lg">
          Go home
        </ButtonLink>
      </div>
    </Container>
  );
}
