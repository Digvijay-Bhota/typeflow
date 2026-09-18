"use client";

import { useEffect } from "react";
import Link from "next/link";

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
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <div className="text-tf-neutral-800 font-mono text-6xl font-bold">⚠</div>
        <h1 className="text-tf-neutral-200 text-2xl font-semibold">
          Something went wrong
        </h1>
        <p className="text-muted text-sm">
          An unexpected error occurred. Your typing data has not been lost.
          {error.digest && (
            <span className="text-tf-neutral-600 mt-1 block font-mono text-xs">
              Error ID: {error.digest}
            </span>
          )}
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={reset}
            className="bg-accent hover:bg-accent rounded-lg px-5 py-2 font-medium text-white transition-colors"
          >
            Try again
          </button>
          <Link
            href="/"
            className="border-tf-neutral-700 hover:border-tf-neutral-500 text-tf-neutral-300 rounded-lg border px-5 py-2 transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
