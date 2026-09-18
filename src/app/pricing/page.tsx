import React from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { constructMetadata } from "@/lib/seo";
import {
  PRO_MONTHLY_PRICE_DISPLAY,
  PRO_YEARLY_PRICE_DISPLAY,
  PRO_YEARLY_MONTHLY_DISPLAY,
} from "@/lib/constants";

export const metadata = constructMetadata({
  title: "Pricing — TypeFlow Pro",
  description:
    "Upgrade to TypeFlow Pro for advanced analytics, weak-key training, custom themes, and more.",
  path: "/pricing",
  noindex: false,
});

const FREE_FEATURES = [
  "All basic typing tests (timed, words, zen, code)",
  "Basic result summary",
  "Typing history",
  "Basic session analytics",
  "Standard themes",
  "Certificate purchases",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Advanced result analytics",
  "Long-term trend analysis",
  "Weak-key training",
  "Advanced practice sessions",
  "Custom sound packs",
  "Custom themes",
  "Exportable performance report",
];

export default function PricingPage() {
  return (
    <div className="bg-background min-h-screen">
      <div className="animate-fade-in mx-auto max-w-5xl px-4 py-16">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-foreground mb-4 text-4xl font-black">
            Simple, honest pricing
          </h1>
          <p className="text-muted mx-auto max-w-2xl text-lg">
            TypeFlow is free to use. Upgrade to Pro for deeper insights and advanced
            practice features.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 items-stretch gap-6 md:grid-cols-3">
          {/* Free Plan */}
          <div className="bg-surface border-border flex flex-col rounded-3xl border p-8 shadow-sm">
            <div className="mb-8">
              <h2 className="text-foreground mb-2 text-xl font-bold">Free</h2>
              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-foreground text-4xl font-black">₹0</span>
                <span className="text-muted font-medium">forever</span>
              </div>
              <p className="text-muted text-sm">
                Everything you need to practice and improve your typing.
              </p>
            </div>
            <ul className="mb-8 flex-1 space-y-4">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm">
                  <Check className="text-accent h-5 w-5 shrink-0" />
                  <span className="text-foreground">{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/"
              className="border-border hover:bg-surface-elevated block rounded-xl border px-4 py-3 text-center font-semibold transition-all"
            >
              Start typing free
            </Link>
          </div>

          {/* Pro Monthly */}
          <div className="bg-surface border-accent relative z-10 flex scale-105 flex-col rounded-3xl border-2 p-8 shadow-lg">
            <div className="absolute inset-x-0 -top-4 flex justify-center">
              <span className="bg-accent text-accent-foreground flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold">
                <Sparkles className="h-3 w-3" /> Most Popular
              </span>
            </div>
            <div className="mb-8">
              <h2 className="text-foreground mb-2 text-xl font-bold">Pro Monthly</h2>
              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-foreground text-4xl font-black">
                  {PRO_MONTHLY_PRICE_DISPLAY}
                </span>
                <span className="text-muted font-medium">/mo</span>
              </div>
              <p className="text-muted text-sm">
                Full Pro access, billed monthly. Cancel any time.
              </p>
            </div>
            <ul className="mb-8 flex-1 space-y-4">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm">
                  <Check className="text-accent h-5 w-5 shrink-0" />
                  <span className="text-foreground">{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/dashboard/billing"
              className="bg-accent text-accent-foreground block rounded-xl px-4 py-3 text-center font-semibold transition-all hover:opacity-90"
            >
              Upgrade to Pro Monthly
            </Link>
          </div>

          {/* Pro Yearly */}
          <div className="bg-surface border-border flex flex-col rounded-3xl border p-8 shadow-sm">
            <div className="mb-8">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-foreground text-xl font-bold">Pro Yearly</h2>
                <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-500">
                  Save ~33%
                </span>
              </div>
              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-foreground text-4xl font-black">
                  {PRO_YEARLY_PRICE_DISPLAY}
                </span>
                <span className="text-muted font-medium">/yr</span>
              </div>
              <p className="text-accent mb-1 text-sm font-medium">
                {PRO_YEARLY_MONTHLY_DISPLAY}/month effective
              </p>
              <p className="text-muted text-sm">
                Full Pro access, billed yearly. Cancel any time.
              </p>
            </div>
            <ul className="mb-8 flex-1 space-y-4">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm">
                  <Check className="text-accent h-5 w-5 shrink-0" />
                  <span className="text-foreground">{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/dashboard/billing"
              className="border-accent text-accent hover:bg-accent/10 block rounded-xl border-2 px-4 py-3 text-center font-semibold transition-all"
            >
              Upgrade to Pro Yearly
            </Link>
          </div>
        </div>

        {/* FAQ / notes */}
        <div className="mt-16 space-y-2 text-center">
          <p className="text-muted text-sm">All prices in INR. GST may apply.</p>
          <p className="text-muted text-sm">
            Cancel at any time — you keep Pro access until the end of your billing period.
          </p>
          <p className="text-muted text-sm">
            Free features are never removed or intentionally broken.
          </p>
        </div>
      </div>
    </div>
  );
}
