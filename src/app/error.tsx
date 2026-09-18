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
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-4 max-w-md">
        <div className="font-mono text-6xl font-bold text-tf-neutral-800">
          ⚠
        </div>
        <h1 className="text-2xl font-semibold text-tf-neutral-200">
          Something went wrong
        </h1>
        <p className="text-muted text-sm">
          An unexpected error occurred. Your typing data has not been lost.
          {error.digest && (
            <span className="block mt-1 font-mono text-xs text-tf-neutral-600">
              Error ID: {error.digest}
            </span>
          )}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="px-5 py-2 rounded-lg bg-accent hover:bg-accent text-white font-medium transition-colors"
          >
            Try again
          </button>
          <Link
            href="/"
            className="px-5 py-2 rounded-lg border border-tf-neutral-700 hover:border-tf-neutral-500 text-tf-neutral-300 transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
