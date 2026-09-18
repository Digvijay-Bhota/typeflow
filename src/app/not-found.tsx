import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "404 — Page Not Found",
};

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-4">
        <div className="font-mono text-8xl font-bold text-tf-neutral-800">
          404
        </div>
        <h1 className="text-2xl font-semibold text-tf-neutral-200">
          Page not found
        </h1>
        <p className="text-muted">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link
          href="/"
          className="inline-block mt-4 px-6 py-2.5 rounded-lg bg-accent hover:bg-accent text-white font-medium transition-colors"
        >
          Back to TypeFlow
        </Link>
      </div>
    </main>
  );
}
