import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "404 — Page Not Found",
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="space-y-4 text-center">
        <div className="text-tf-neutral-800 font-mono text-8xl font-bold">404</div>
        <h1 className="text-tf-neutral-200 text-2xl font-semibold">Page not found</h1>
        <p className="text-muted">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link
          href="/"
          className="bg-accent hover:bg-accent mt-4 inline-block rounded-lg px-6 py-2.5 font-medium text-white transition-colors"
        >
          Back to TypeFlow
        </Link>
      </div>
    </main>
  );
}
