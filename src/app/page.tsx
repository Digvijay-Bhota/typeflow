/**
 * TypeFlow Homepage
 *
 * Structure:
 * 1. Header / nav
 * 2. Hero — typing test (immediately usable, no signup)
 * 3. Feature highlights
 * 4. CTA
 *
 * Performance:
 * - No render-blocking resources
 * - Typing test is the LCP element
 * - Charts/analytics sections deferred to Phase 3
 */
import type { Metadata } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { TypingTest } from "@/features/typing/components/TypingTest";

export const metadata: Metadata = {
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  description:
    "Free online typing test. Measure your WPM, track accuracy, practice adaptive typing, and earn verified certificates. No signup required to start.",
  alternates: {
    canonical: "/",
  },
};

import { getAuthenticatedUser } from "@/server/services/auth.service";
import Link from "next/link";

export default async function HomePage() {
  const _user = await getAuthenticatedUser();

  return (
    <main className="flex min-h-screen flex-col">
      {/* Header */}

      {/* Hero — Typing Test */}
      <section className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="mx-auto w-full max-w-3xl space-y-10">
          {/* Headline */}
          <div className="space-y-3 text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              <span className="text-foreground">Type </span>
              <span className="text-accent">faster.</span>
              <span className="text-foreground"> Prove it.</span>
            </h1>
            <p className="text-muted text-lg">
              Free typing tests with real metrics. No signup needed.
            </p>
          </div>

          {/* The typing test — primary LCP */}
          <div className="bg-surface/60 border-border/50 rounded-2xl border p-6 sm:p-8">
            <TypingTest />
          </div>

          {/* Feature pills */}
          <div className="text-muted flex flex-wrap justify-center gap-2 text-sm">
            {[
              "⚡ Instant start",
              "📊 WPM + accuracy",
              "🎯 Code typing",
              "🏆 Verified certificates",
              "📈 Progress tracking",
            ].map((f) => (
              <span
                key={f}
                className="border-border bg-surface/40 rounded-full border px-3 py-1"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features section */}
      <section className="border-border/50 border-t px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-tf-neutral-200 mb-10 text-center text-2xl font-bold">
            Everything you need to type better
          </h2>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-surface/40 border-border/50 hover:border-tf-primary-500/30 rounded-xl border p-5 transition-colors"
              >
                <div className="mb-3 text-2xl">{f.icon}</div>
                <h3 className="text-tf-neutral-200 mb-1 font-semibold">{f.title}</h3>
                <p className="text-muted text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Certificate CTA */}
      <section className="border-border/50 border-t px-4 py-16">
        <div className="mx-auto max-w-2xl space-y-4 text-center">
          <h2 className="text-foreground text-2xl font-bold">
            Prove your typing skills with a verified certificate
          </h2>
          <p className="text-muted">
            Complete a supervised typing test and receive a TypeFlow Verified Certificate
            with a unique ID, QR code, and public verification URL.
          </p>
          <Link
            href="/typing-test-with-certificate"
            className="bg-accent hover:bg-accent mt-4 inline-block rounded-xl px-8 py-3 font-semibold text-white transition-colors"
          >
            Get Certified →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-border/50 border-t px-4 py-8">
        <div className="text-muted mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-sm sm:flex-row">
          <div>
            <span className="text-accent font-mono font-semibold">TypeFlow</span> — Typing
            performance platform
          </div>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-tf-neutral-300 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-tf-neutral-300 transition-colors">
              Terms
            </Link>
            <Link
              href="/how-wpm-is-calculated"
              className="hover:text-tf-neutral-300 transition-colors"
            >
              How WPM works
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

const features = [
  {
    icon: "⚡",
    title: "Instant typing test",
    desc: "Start typing immediately. No account needed. WPM, accuracy, and raw speed measured in real time.",
  },
  {
    icon: "💻",
    title: "Code typing",
    desc: "Practice JavaScript, TypeScript, Python, Java, SQL, and more. Brackets, semicolons, and operators included.",
  },
  {
    icon: "📊",
    title: "Detailed analytics",
    desc: "See your weak keys, error patterns, consistency score, and progress over time.",
  },
  {
    icon: "🏆",
    title: "Verified certificates",
    desc: "Earn a TypeFlow certificate with a unique ID, QR verification code, and shareable URL.",
  },
  {
    icon: "🎯",
    title: "Adaptive practice",
    desc: "Train on your weakest keys. TypeFlow identifies patterns and generates targeted exercises.",
  },
  {
    icon: "📈",
    title: "Progress tracking",
    desc: "Save your history, see trends over 30 days, and set personal records.",
  },
];
