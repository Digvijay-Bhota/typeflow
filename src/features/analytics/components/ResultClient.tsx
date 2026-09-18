"use client";

import React from "react";
import Link from "next/link";
import { Activity, ShieldCheck, Share2, Award, RefreshCw, BarChart2 } from "lucide-react";



import { CERTIFICATE_MIN_WPM, CERTIFICATE_MIN_ACCURACY, CERTIFICATE_MIN_DURATION } from "@/lib/constants";

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
  
  const isCertificateEligible = wpmPassed && accPassed && durationPassed && isVerified && isCertMode && isUserAuthenticated;

  return (
    <div className="max-w-5xl mx-auto space-y-12 animate-fade-in pb-20">
      
      {/* Hero Header */}
      <div className="text-center space-y-4 pt-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface border border-border rounded-full text-sm font-medium mb-4">
          <Activity className="w-4 h-4 text-accent" />
          Test Complete
        </div>
        <h1 className="text-5xl font-black tracking-tight flex items-center justify-center gap-4">
          <span>{wpm}</span> <span className="text-3xl text-muted font-bold">WPM</span>
        </h1>
        <p className="text-xl text-muted">
          Your accuracy was <span className="text-foreground font-bold">{accuracy}%</span>
        </p>
      </div>

      {/* Primary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm text-center">
          <div className="text-muted text-sm font-medium mb-2">Speed</div>
          <div className="text-3xl font-bold text-accent">{wpm} <span className="text-lg text-muted">WPM</span></div>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm text-center">
          <div className="text-muted text-sm font-medium mb-2">Accuracy</div>
          <div className="text-3xl font-bold text-emerald-500">{accuracy}%</div>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm text-center">
          <div className="text-muted text-sm font-medium mb-2">Time</div>
          <div className="text-3xl font-bold text-foreground">{(result.duration / 1000).toFixed(0)}s</div>
        </div>
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm text-center">
          <div className="text-muted text-sm font-medium mb-2">Consistency</div>
          <div className="text-3xl font-bold text-blue-500">{Math.round((result.metrics?.consistency || 0) * 100)}%</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Breakdown */}
        <div className="md:col-span-2 bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <BarChart2 className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-bold">Keystroke Breakdown</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-background border border-border">
              <div className="text-sm text-muted mb-1">Correct</div>
              <div className="text-2xl font-bold text-emerald-500">{result.metrics?.correctChars || 0}</div>
            </div>
            <div className="p-4 rounded-xl bg-background border border-border">
              <div className="text-sm text-muted mb-1">Incorrect</div>
              <div className="text-2xl font-bold text-danger">{result.metrics?.incorrectChars || 0}</div>
            </div>
            <div className="p-4 rounded-xl bg-background border border-border">
              <div className="text-sm text-muted mb-1">Total Keystrokes</div>
              <div className="text-2xl font-bold text-foreground">{result.metrics?.totalChars || 0}</div>
            </div>
            <div className="p-4 rounded-xl bg-background border border-border">
              <div className="text-sm text-muted mb-1">Raw WPM</div>
              <div className="text-2xl font-bold text-blue-500">{Math.round(result.metrics?.rawWpm || wpm)}</div>
            </div>
          </div>
        </div>

        {/* Certificate Eligibility */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
              <h2 className="text-lg font-bold">Verification</h2>
            </div>
            {isCertificateEligible ? (
              <p className="text-muted text-sm mb-6">
                Excellent performance. You are eligible to claim a verified certificate for this result.
              </p>
            ) : (
              <p className="text-muted text-sm mb-6">
                Certificates require at least {CERTIFICATE_MIN_WPM} net WPM, {CERTIFICATE_MIN_ACCURACY}% accuracy, and a {CERTIFICATE_MIN_DURATION}s test duration. 
                {!isCertMode && " You must take the test in Certificate Mode."}
                {!isUserAuthenticated && " You must be logged in."}
                {!isVerified && " The result must be verified without interruptions."}
              </p>
            )}
          </div>
          
          <Link 
            href="/typing-test-with-certificate"
            className={`flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all ${
              isCertificateEligible 
                ? "bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm"
                : "bg-surface-elevated text-foreground border border-border hover:border-accent"
            }`}
          >
            <Award className="w-4 h-4" />
            {isCertificateEligible ? "Claim Certificate" : "Learn More"}
          </Link>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-8 border-t border-border">
        {isOwner && (
          <Link 
            href="/typing-test"
            className="flex items-center gap-2 px-6 py-3 bg-foreground text-background font-medium rounded-xl hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="w-4 h-4" /> Next Test
          </Link>
        )}
        <button 
          onClick={() => {
            navigator.clipboard.writeText(window.location.href);
            // In a real app we'd toast here
          }}
          className="flex items-center gap-2 px-6 py-3 bg-surface border border-border font-medium rounded-xl hover:border-accent transition-colors"
        >
          <Share2 className="w-4 h-4" /> Share Result
        </button>
      </div>

    </div>
  );
}
