"use client";

import React from "react";
import Link from "next/link";
import {
  Activity,
  ShieldCheck,
  Share2,
  RefreshCw,
  AlertTriangle,
  Target,
  Award,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Line,
  LineChart,
} from "recharts";

export function ResultClient({ result, comparison }: { result: any; comparison?: any }) {
  const wpm = Math.round(result.wpm);
  const rawWpm = Math.round(result.rawWpm || wpm);
  const accuracy = Math.round(result.accuracy * 100);
  const consistency = result.consistency ? Math.round(result.consistency * 100) : 0;

  const isVerified = result.integrityStatus === "VERIFIED";

  // Reconstruct Chart Data from intervalWpms
  let chartData: any[] = [];
  if (result.integritySignals && Array.isArray(result.integritySignals.intervalWpms)) {
    chartData = result.integritySignals.intervalWpms.map((val: number, i: number) => ({
      second: i + 1,
      wpm: Math.round(val),
    }));
  } else if (result.eventTrace?.events) {
    chartData = [];
  }

  // Extract Weak Keys from errorMap
  let weakKeys: { key: string; count: number }[] = [];
  if (result.errorMap && typeof result.errorMap === "object") {
    const map = result.errorMap as Record<string, any>;
    weakKeys = Object.entries(map)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([key, val]) => ({ key, count: val.count }));
  }

  const handleShare = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url);
    alert("Result link copied to clipboard!");
  };

  return (
    <div className="animate-fade-in mx-auto flex w-full max-w-5xl flex-col gap-10">
      {/* HEADER SECTION */}
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div>
          <h1 className="mb-3 text-4xl font-black">Performance Report</h1>
          <div className="flex items-center gap-3 text-sm font-bold">
            <span className="bg-surface-elevated text-foreground border-border rounded-full border px-4 py-1.5 tracking-widest uppercase shadow-sm">
              {result.session?.mode}
            </span>
            {result.session?.language === "CODE" ? (
              <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-1.5 tracking-widest text-blue-400 uppercase">
                {result.session?.codeLanguage}
              </span>
            ) : (
              <span className="text-muted tracking-widest uppercase">
                {result.session?.language}
              </span>
            )}
            {isVerified && (
              <span className="shadow-glow flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-emerald-500 shadow-emerald-500/20">
                <ShieldCheck className="h-4 w-4" /> Verified
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleShare}
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-accent/20 flex items-center gap-2 rounded-xl px-6 py-3 font-bold shadow-lg transition-all"
          >
            <Share2 className="h-4 w-4" /> Share
          </button>
        </div>
      </div>

      {/* METRICS SHOWCASE */}
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <div className="bg-surface border-border group relative flex flex-col items-center justify-center overflow-hidden rounded-3xl border p-8 text-center shadow-sm">
          <div className="bg-accent/5 absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" />
          <span className="text-muted relative z-10 mb-3 flex items-center gap-2 text-sm font-bold tracking-widest uppercase">
            <Activity className="text-accent h-4 w-4" /> Net WPM
          </span>
          <span className="text-foreground relative z-10 text-7xl font-black">{wpm}</span>
        </div>
        <div className="bg-surface border-border group relative flex flex-col items-center justify-center overflow-hidden rounded-3xl border p-8 text-center shadow-sm">
          <div className="absolute inset-0 bg-emerald-500/5 opacity-0 transition-opacity group-hover:opacity-100" />
          <span className="text-muted relative z-10 mb-3 flex items-center gap-2 text-sm font-bold tracking-widest uppercase">
            <Target className="h-4 w-4 text-emerald-500" /> Accuracy
          </span>
          <span className="text-foreground relative z-10 text-7xl font-black">
            {accuracy}
            <span className="text-muted ml-1 text-3xl">%</span>
          </span>
        </div>
        <div className="bg-surface border-border flex flex-col items-center justify-center rounded-3xl border p-8 text-center shadow-sm">
          <span className="text-muted mb-3 text-sm font-bold tracking-widest uppercase">
            Consistency
          </span>
          <span className="text-foreground text-6xl font-black">
            {consistency}
            <span className="text-muted ml-1 text-2xl">%</span>
          </span>
        </div>
        <div className="bg-surface border-border flex flex-col items-center justify-center rounded-3xl border p-8 text-center shadow-sm">
          <span className="text-muted mb-3 text-sm font-bold tracking-widest uppercase">
            Raw WPM
          </span>
          <span className="text-muted text-6xl font-black">{rawWpm}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* PERFORMANCE GRAPH */}
        <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm lg:col-span-2">
          <h2 className="mb-6 text-2xl font-bold">Speed Over Time</h2>
          {chartData.length > 0 ? (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--border)"
                    opacity={0.4}
                  />
                  <XAxis
                    dataKey="second"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--surface-elevated)",
                      borderRadius: "12px",
                      border: "1px solid var(--border)",
                      color: "var(--foreground)",
                      padding: "12px",
                    }}
                    itemStyle={{
                      color: "var(--foreground)",
                      fontWeight: "bold",
                      fontSize: "16px",
                    }}
                    labelStyle={{
                      color: "var(--text-muted)",
                      marginBottom: "8px",
                      textTransform: "uppercase",
                      fontSize: "12px",
                      letterSpacing: "1px",
                    }}
                    formatter={(val) => [`${val} WPM`, "Speed"]}
                    labelFormatter={(val) => `Second ${val}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="wpm"
                    stroke="var(--accent)"
                    strokeWidth={4}
                    dot={false}
                    activeDot={{
                      r: 8,
                      strokeWidth: 0,
                      fill: "var(--accent)",
                      style: { filter: "drop-shadow(0 0 8px var(--accent))" },
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="border-border bg-background/50 flex h-[280px] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed">
              <Activity className="text-muted mb-3 h-8 w-8 opacity-50" />
              <p className="text-muted font-bold tracking-wide">
                Timeline data not available
              </p>
            </div>
          )}
        </div>

        {/* COMPARISON ANALYSIS (FOR PRACTICE) */}
        {result.session.mode === "PRACTICE" && comparison && (
          <div className="flex flex-col space-y-6">
            <div className="bg-surface border-border flex-1 rounded-3xl border p-8 shadow-sm">
              <h2 className="mb-6 flex items-center gap-2 text-xl font-bold">
                <Target className="text-accent h-5 w-5" /> Practice Results
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-background rounded-2xl border p-4 text-center">
                  <p className="text-muted mb-2 text-xs font-bold tracking-wider uppercase">
                    Before
                  </p>
                  <p className="text-2xl font-black">
                    {comparison.beforeWpm} <span className="text-sm">WPM</span>
                  </p>
                  <p className="text-sm font-medium">{comparison.beforeAccuracy}% Acc</p>
                </div>
                <div className="bg-background rounded-2xl border p-4 text-center">
                  <p className="text-muted mb-2 text-xs font-bold tracking-wider uppercase">
                    After
                  </p>
                  <p className="text-2xl font-black">
                    {wpm} <span className="text-sm">WPM</span>
                  </p>
                  <p className="text-sm font-medium">{accuracy}% Acc</p>
                </div>
              </div>
              <div className="mt-6 text-center text-sm font-medium">
                {wpm >= comparison.beforeWpm && accuracy >= comparison.beforeAccuracy ? (
                  <p className="text-emerald-500">
                    Great job! You improved your speed and accuracy on your weak keys.
                  </p>
                ) : wpm >= comparison.beforeWpm ? (
                  <p className="text-emerald-500">
                    Your speed improved! Keep working on accuracy.
                  </p>
                ) : accuracy >= comparison.beforeAccuracy ? (
                  <p className="text-emerald-500">
                    Your accuracy improved! Keep practicing for speed.
                  </p>
                ) : (
                  <p className="text-muted">Keep practicing to improve your weak keys.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ERROR ANALYSIS */}
        <div className="flex flex-col space-y-6">
          <div className="bg-surface border-border flex-1 rounded-3xl border p-8 shadow-sm">
            <h2 className="mb-6 flex items-center gap-2 text-xl font-bold">
              <AlertTriangle className="text-warning h-5 w-5" /> Weak Keys
            </h2>
            {weakKeys.length > 0 ? (
              <>
                <div className="space-y-3">
                  {weakKeys.map((wk, i) => (
                    <div
                      key={i}
                      className="bg-background border-border hover:border-warning/50 flex items-center justify-between rounded-2xl border p-3.5 transition-colors"
                    >
                      <kbd className="bg-surface-elevated border-border text-foreground rounded-lg border px-4 py-1.5 font-mono text-xl font-black shadow-sm">
                        {wk.key === " " ? "Space" : wk.key}
                      </kbd>
                      <div className="flex flex-col items-end">
                        <span className="text-foreground text-sm font-bold">
                          {wk.count}
                        </span>
                        <span className="text-muted text-[10px] font-bold tracking-widest uppercase">
                          misses
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex justify-center">
                  <Link
                    href={`/practice?sourceResultId=${result.id}`}
                    className="bg-accent hover:bg-accent/90 text-accent-foreground flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-95"
                  >
                    <Target className="h-4 w-4" />
                    Practice these keys
                  </Link>
                </div>
              </>
            ) : (
              <div className="py-10 text-center">
                <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-emerald-500 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]" />
                <p className="text-sm font-bold text-emerald-500/80">Flawless typing!</p>
                <p className="text-muted mt-1 text-xs font-medium">Zero mistakes made.</p>
              </div>
            )}
          </div>

          <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm">
            <h2 className="mb-5 text-xl font-bold">Keystroke Breakdown</h2>
            <div className="space-y-4 text-sm font-bold">
              <div className="flex items-center justify-between py-1">
                <span className="text-muted text-xs tracking-wider uppercase">
                  Total Keystrokes
                </span>
                <span className="text-lg">
                  {result.totalKeystrokes || result.totalChars}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-muted text-xs tracking-wider uppercase">
                  Correct
                </span>
                <span className="text-lg text-emerald-500">{result.correctChars}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-muted text-xs tracking-wider uppercase">
                  Incorrect
                </span>
                <span className="text-danger text-lg">{result.incorrectChars}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-muted text-xs tracking-wider uppercase">
                  Fixed Errors
                </span>
                <span className="text-lg text-orange-500">{result.correctedErrors}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DETERMINISTIC INSIGHTS */}
      {chartData.length > 0 && (
        <div className="bg-accent/5 border-accent/20 text-foreground flex items-center gap-4 rounded-3xl border p-6 shadow-sm">
          <Activity className="text-accent h-6 w-6" />
          <div>
            <h3 className="text-muted mb-1 text-sm font-bold tracking-widest uppercase">
              Performance Insight
            </h3>
            <p className="text-lg font-medium">
              {(() => {
                if (chartData.length >= 9) {
                  // Robust calculation dividing the test into thirds (Start, Middle, End)
                  const third = Math.floor(chartData.length / 3);

                  const startSegment = chartData.slice(0, third);
                  const endSegment = chartData.slice(chartData.length - third);

                  const startWpm = startSegment.reduce((a, b) => a + b.wpm, 0) / third;
                  const endWpm = endSegment.reduce((a, b) => a + b.wpm, 0) / third;
                  const variance = Math.abs(startWpm - endWpm);

                  if (variance < 3) {
                    return `Incredible pacing. You maintained a rock-solid speed (variance < 3 WPM) throughout the entire duration.`;
                  }
                  if (endWpm > startWpm + 5) {
                    return `You accelerated significantly as you warmed up, starting at ${Math.round(startWpm)} WPM and pushing to ${Math.round(endWpm)} WPM during the final stretch.`;
                  }
                  if (endWpm < startWpm - 5) {
                    return `Your stamina dropped towards the end (from ${Math.round(startWpm)} WPM down to ${Math.round(endWpm)} WPM). Try to establish a more sustainable initial rhythm.`;
                  }
                  return `Good consistency. Your speed remained largely stable from start to finish.`;
                }

                // Fallback for extremely short tests
                return accuracy === 100
                  ? "Perfect accuracy! Now try pushing your raw speed slightly higher on the next test."
                  : "Focus purely on hitting the correct keys—your muscle memory and speed will naturally follow.";
              })()}
            </p>
          </div>
        </div>
      )}

      {/* NEXT STEPS ACTIONS */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Link
          href="/typing-test"
          className="bg-surface hover:bg-surface-elevated border-border group flex flex-col items-center justify-center gap-3 rounded-3xl border p-8 shadow-sm transition-all"
        >
          <div className="rounded-full bg-blue-500/10 p-4 text-blue-400 transition-all group-hover:scale-110 group-hover:bg-blue-500/20">
            <RefreshCw className="h-6 w-6" />
          </div>
          <span className="text-lg font-bold">Try Again</span>
          <span className="text-muted text-center text-sm">Beat your current score</span>
        </Link>
        <Link
          href="/typing-test"
          className="bg-surface hover:bg-surface-elevated border-border group flex flex-col items-center justify-center gap-3 rounded-3xl border p-8 shadow-sm transition-all"
        >
          <div className="rounded-full bg-orange-500/10 p-4 text-orange-400 transition-all group-hover:scale-110 group-hover:bg-orange-500/20">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <span className="text-lg font-bold">Practice Keys</span>
          <span className="text-muted text-center text-sm">
            Focus on {weakKeys[0]?.key || "weak"} weaknesses
          </span>
        </Link>
        <Link
          href="/dashboard/analytics"
          className="bg-surface hover:bg-surface-elevated border-border group flex flex-col items-center justify-center gap-3 rounded-3xl border p-8 shadow-sm transition-all"
        >
          <div className="rounded-full bg-emerald-500/10 p-4 text-emerald-500 transition-all group-hover:scale-110 group-hover:bg-emerald-500/20">
            <Target className="h-6 w-6" />
          </div>
          <span className="text-lg font-bold">View Analytics</span>
          <span className="text-muted text-center text-sm">See long-term trends</span>
        </Link>
      </div>

      {/* CERTIFICATE ELIGIBILITY */}
      {result.session?.trustTier === "CERTIFICATE" && (
        <div className="from-surface to-surface-elevated border-border relative overflow-hidden rounded-3xl border bg-gradient-to-r p-10 shadow-lg">
          <div className="bg-accent/5 absolute top-0 right-0 h-64 w-64 translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl" />
          <div className="relative z-10 flex flex-col items-center justify-between gap-8 md:flex-row">
            <div className="flex items-center gap-6">
              <div className="shadow-glow rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 shadow-emerald-500/20">
                <Award className="h-10 w-10 text-emerald-500" />
              </div>
              <div>
                <h2 className="mb-2 text-2xl font-black">Certificate Eligibility</h2>
                <p className="text-muted max-w-lg leading-relaxed font-medium">
                  {isVerified && wpm >= 40 && accuracy >= 95
                    ? "Outstanding performance. Your verified test meets the official requirements for a TypeFlow Typing Certificate."
                    : "Keep practicing. You need a verified test with at least 40 WPM and 95% accuracy to qualify for a certificate."}
                </p>
              </div>
            </div>
            {isVerified && wpm >= 40 && accuracy >= 95 && (
              <button className="shadow-glow transform rounded-2xl bg-emerald-500 px-8 py-4 font-black tracking-wide whitespace-nowrap text-white shadow-emerald-500/30 transition-all hover:-translate-y-1 hover:bg-emerald-400">
                Claim Certificate
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
