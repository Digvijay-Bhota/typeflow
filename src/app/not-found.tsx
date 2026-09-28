import type { Metadata } from "next";
import { ButtonLink, Container } from "@/components/ui";

export const metadata: Metadata = {
  title: "404 — Page Not Found",
};

// Rendered inside the root layout's <main>: no <main> of its own.
export default function NotFound() {
  return (
    <Container
      size="narrow"
      className="flex flex-1 flex-col items-center justify-center py-24 text-center"
    >
      <p aria-hidden="true" className="text-muted font-mono text-6xl font-semibold">
        404
      </p>
      <h1 className="text-title mt-4 font-semibold">Page not found</h1>
      <p className="text-secondary mt-3">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <ButtonLink href="/" size="lg" className="mt-8">
        Back to TypeFlow
      </ButtonLink>
    </Container>
  );
}
