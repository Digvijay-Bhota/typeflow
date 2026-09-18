"use client";

import React from "react";
import Link from "next/link";
import { Activity, ShieldCheck, Share2, Award, RefreshCw, BarChart2 } from "lucide-react";

import {
  CERTIFICATE_MIN_WPM,
  CERTIFICATE_MIN_ACCURACY,
  CERTIFICATE_MIN_DURATION,
} from "@/lib/constants";

export function ResultClient({ result, isOwner }: { result: any; isOwner: boolean }) {
  const wpm = Math.round(result.wpm);
  const netWpm = Math.round(result.netWpm || wpm); // fallback if netWpm is missing
  const accuracy = Math.round(result.accuracy * 100);

  // Backend authoritative rules
  const sessionDurationSec = result.session?.duration || 0;

  const wpmPassed = netWpm >= CERTIFICATE_MIN_WPM;
  const accPassed = accuracy >= CERTIFICATE_MIN_ACCURACY;
  const durationPassed = sessionDurationSec >= CERTIFICATE_MIN_DURATION;
  const isVerified = result.integrityStatus === "VERIFIED";
  const isCertMode = result.session?.trustTier === "CERTIFICATE";
  const isUserAuthenticated = !!result.userId;

  const isCertificateEligible =
    wpmPassed &&
    accPassed &&
    durationPassed &&
    isVerified &&
    isCertMode &&
    isUserAuthenticated;

  return (
    <div className="animate-fade-in mx-auto max-w-5xl space-y-12 pb-20">
      {/* Hero Header */}
      <div className="space-y-4 pt-8 text-center">
        <div className="bg-surface border-border mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium">
          <Activity className="text-accent h-4 w-4" />
          Test Complete
        </div>
        <h1 className="flex items-center justify-center gap-4 text-5xl font-black tracking-tight">
          <span>{wpm}</span> <span className="text-muted text-3xl font-bold">WPM</span>
        </h1>
        <p className="text-muted text-xl">
          Your accuracy was <span className="text-foreground font-bold">{accuracy}%</span>
        </p>
      </div>

      {/* Primary Metrics */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="bg-surface border-border rounded-2xl border p-6 text-center shadow-sm">
          <div className="text-muted mb-2 text-sm font-medium">Speed</div>
          <div className="text-accent text-3xl font-bold">
            {wpm} <span className="text-muted text-lg">WPM</span>
          </div>
        </div>
        <div className="bg-surface border-border rounded-2xl border p-6 text-center shadow-sm">
          <div className="text-muted mb-2 text-sm font-medium">Accuracy</div>
          <div className="text-3xl font-bold text-emerald-500">{accuracy}%</div>
        </div>
        <div className="bg-surface border-border rounded-2xl border p-6 text-center shadow-sm">
          <div className="text-muted mb-2 text-sm font-medium">Time</div>
          <div className="text-foreground text-3xl font-bold">
            {(result.duration / 1000).toFixed(0)}s
          </div>
        </div>
        <div className="bg-surface border-border rounded-2xl border p-6 text-center shadow-sm">
          <div className="text-muted mb-2 text-sm font-medium">Consistency</div>
          <div className="text-3xl font-bold text-blue-500">
            {Math.round((result.metrics?.consistency || 0) * 100)}%
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Breakdown */}
        <div className="bg-surface border-border rounded-2xl border p-6 shadow-sm md:col-span-2">
          <div className="mb-6 flex items-center gap-2">
            <BarChart2 className="text-accent h-5 w-5" />
            <h2 className="text-lg font-bold">Keystroke Breakdown</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-background border-border rounded-xl border p-4">
              <div className="text-muted mb-1 text-sm">Correct</div>
              <div className="text-2xl font-bold text-emerald-500">
                {result.metrics?.correctChars || 0}
              </div>
            </div>
            <div className="bg-background border-border rounded-xl border p-4">
              <div className="text-muted mb-1 text-sm">Incorrect</div>
              <div className="text-danger text-2xl font-bold">
                {result.metrics?.incorrectChars || 0}
              </div>
            </div>
            <div className="bg-background border-border rounded-xl border p-4">
              <div className="text-muted mb-1 text-sm">Total Keystrokes</div>
              <div className="text-foreground text-2xl font-bold">
                {result.metrics?.totalChars || 0}
              </div>
            </div>
            <div className="bg-background border-border rounded-xl border p-4">
              <div className="text-muted mb-1 text-sm">Raw WPM</div>
              <div className="text-2xl font-bold text-blue-500">
                {Math.round(result.metrics?.rawWpm || wpm)}
              </div>
            </div>
          </div>
        </div>

        {/* Certificate Eligibility */}
        <div className="bg-surface border-border flex flex-col justify-between rounded-2xl border p-6 shadow-sm">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              <h2 className="text-lg font-bold">Verification</h2>
            </div>
            {isCertificateEligible ? (
              <p className="text-muted mb-6 text-sm">
                Excellent performance. You are eligible to claim a verified certificate
                for this result.
              </p>
            ) : (
              <p className="text-muted mb-6 text-sm">
                Certificates require at least {CERTIFICATE_MIN_WPM} net WPM,{" "}
                {CERTIFICATE_MIN_ACCURACY}% accuracy, and a {CERTIFICATE_MIN_DURATION}s
                test duration.
                {!isCertMode && " You must take the test in Certificate Mode."}
                {!isUserAuthenticated && " You must be logged in."}
                {!isVerified && " The result must be verified without interruptions."}
              </p>
            )}
          </div>

          <Link
            href="/typing-test-with-certificate"
            className={`flex items-center justify-center gap-2 rounded-xl py-3 font-medium transition-all ${
              isCertificateEligible
                ? "bg-emerald-500 text-white shadow-sm hover:bg-emerald-600"
                : "bg-surface-elevated text-foreground border-border hover:border-accent border"
            }`}
          >
            <Award className="h-4 w-4" />
            {isCertificateEligible ? "Claim Certificate" : "Learn More"}
          </Link>
        </div>
      </div>

      {/* Action Bar */}
      <div className="border-border flex flex-wrap items-center justify-center gap-4 border-t pt-8">
        {isOwner && (
          <Link
            href="/typing-test"
            className="bg-foreground text-background flex items-center gap-2 rounded-xl px-6 py-3 font-medium transition-opacity hover:opacity-90"
          >
            <RefreshCw className="h-4 w-4" /> Next Test
          </Link>
        )}
        <button
          onClick={() => {
            navigator.clipboard.writeText(window.location.href);
            // In a real app we'd toast here
          }}
          className="bg-surface border-border hover:border-accent flex items-center gap-2 rounded-xl border px-6 py-3 font-medium transition-colors"
        >
          <Share2 className="h-4 w-4" /> Share Result
        </button>
      </div>
    </div>
  );
}
