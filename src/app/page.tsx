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
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      

      {/* Hero — Typing Test */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-3xl mx-auto space-y-10">
          {/* Headline */}
          <div className="text-center space-y-3">
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
              <span className="text-foreground">Type </span>
              <span className="text-accent">faster.</span>
              <span className="text-foreground"> Prove it.</span>
            </h1>
            <p className="text-muted text-lg">
              Free typing tests with real metrics. No signup needed.
            </p>
          </div>

          {/* The typing test — primary LCP */}
          <div className="bg-surface/60 border border-border/50 rounded-2xl p-6 sm:p-8">
            <TypingTest />
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-2 text-sm text-muted">
            {[
              "⚡ Instant start",
              "📊 WPM + accuracy",
              "🎯 Code typing",
              "🏆 Verified certificates",
              "📈 Progress tracking",
            ].map((f) => (
              <span
                key={f}
                className="px-3 py-1 rounded-full border border-border bg-surface/40"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features section */}
      <section className="px-4 py-16 border-t border-border/50">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-tf-neutral-200 mb-10">
            Everything you need to type better
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="p-5 rounded-xl bg-surface/40 border border-border/50 hover:border-tf-primary-500/30 transition-colors"
              >
                <div className="text-2xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-tf-neutral-200 mb-1">
                  {f.title}
                </h3>
                <p className="text-muted text-sm leading-relaxed">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Certificate CTA */}
      <section className="px-4 py-16 border-t border-border/50">
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <h2 className="text-2xl font-bold text-foreground">
            Prove your typing skills with a verified certificate
          </h2>
          <p className="text-muted">
            Complete a supervised typing test and receive a TypeFlow Verified
            Certificate with a unique ID, QR code, and public verification URL.
          </p>
          <Link
            href="/typing-test-with-certificate"
            className="inline-block mt-4 px-8 py-3 rounded-xl bg-accent hover:bg-accent text-white font-semibold transition-colors"
          >
            Get Certified →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 px-4 py-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted">
          <div>
            <span className="text-accent font-mono font-semibold">
              TypeFlow
            </span>{" "}
            — Typing performance platform
          </div>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-tf-neutral-300 transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-tf-neutral-300 transition-colors">
              Terms
            </Link>
            <Link href="/how-wpm-is-calculated" className="hover:text-tf-neutral-300 transition-colors">
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
