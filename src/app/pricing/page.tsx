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
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-16 animate-fade-in">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-black text-foreground mb-4">
            Simple, honest pricing
          </h1>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            TypeFlow is free to use. Upgrade to Pro for deeper insights and
            advanced practice features.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {/* Free Plan */}
          <div className="bg-surface border border-border rounded-3xl p-8 flex flex-col shadow-sm">
            <div className="mb-8">
              <h2 className="text-xl font-bold text-foreground mb-2">
                Free
              </h2>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-black text-foreground">
                  ₹0
                </span>
                <span className="text-muted font-medium">forever</span>
              </div>
              <p className="text-sm text-muted">
                Everything you need to practice and improve your typing.
              </p>
            </div>
            <ul className="flex-1 space-y-4 mb-8">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm">
                  <Check className="w-5 h-5 text-accent shrink-0" />
                  <span className="text-foreground">
                    {f}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/"
              className="block text-center py-3 px-4 rounded-xl border border-border font-semibold hover:bg-surface-elevated transition-all"
            >
              Start typing free
            </Link>
          </div>

          {/* Pro Monthly */}
          <div className="bg-surface border-2 border-accent rounded-3xl p-8 flex flex-col relative shadow-lg scale-105 z-10">
            <div className="absolute -top-4 inset-x-0 flex justify-center">
              <span className="bg-accent text-accent-foreground text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Most Popular
              </span>
            </div>
            <div className="mb-8">
              <h2 className="text-xl font-bold text-foreground mb-2">
                Pro Monthly
              </h2>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-black text-foreground">
                  {PRO_MONTHLY_PRICE_DISPLAY}
                </span>
                <span className="text-muted font-medium">/mo</span>
              </div>
              <p className="text-sm text-muted">
                Full Pro access, billed monthly. Cancel any time.
              </p>
            </div>
            <ul className="flex-1 space-y-4 mb-8">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm">
                  <Check className="w-5 h-5 text-accent shrink-0" />
                  <span className="text-foreground">
                    {f}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/dashboard/billing"
              className="block text-center py-3 px-4 rounded-xl bg-accent text-accent-foreground font-semibold hover:opacity-90 transition-all"
            >
              Upgrade to Pro Monthly
            </Link>
          </div>

          {/* Pro Yearly */}
          <div className="bg-surface border border-border rounded-3xl p-8 flex flex-col shadow-sm">
            <div className="mb-8">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-bold text-foreground">
                  Pro Yearly
                </h2>
                <span className="text-xs font-bold bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded-full">
                  Save ~33%
                </span>
              </div>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-black text-foreground">
                  {PRO_YEARLY_PRICE_DISPLAY}
                </span>
                <span className="text-muted font-medium">/yr</span>
              </div>
              <p className="text-sm text-accent font-medium mb-1">
                {PRO_YEARLY_MONTHLY_DISPLAY}/month effective
              </p>
              <p className="text-sm text-muted">
                Full Pro access, billed yearly. Cancel any time.
              </p>
            </div>
            <ul className="flex-1 space-y-4 mb-8">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm">
                  <Check className="w-5 h-5 text-accent shrink-0" />
                  <span className="text-foreground">
                    {f}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              href="/dashboard/billing"
              className="block text-center py-3 px-4 rounded-xl border-2 border-accent text-accent font-semibold hover:bg-accent/10 transition-all"
            >
              Upgrade to Pro Yearly
            </Link>
          </div>
        </div>

        {/* FAQ / notes */}
        <div className="mt-16 text-center space-y-2">
          <p className="text-sm text-muted">
            All prices in INR. GST may apply.
          </p>
          <p className="text-sm text-muted">
            Cancel at any time — you keep Pro access until the end of your
            billing period.
          </p>
          <p className="text-sm text-muted">
            Free features are never removed or intentionally broken.
          </p>
        </div>
      </div>
    </div>
  );
}
