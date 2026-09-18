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
  Award
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

export function ResultClient({ result }: { result: any }) {
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
  let weakKeys: { key: string, count: number }[] = [];
  if (result.errorMap && typeof result.errorMap === 'object') {
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black mb-3">Performance Report</h1>
          <div className="flex items-center gap-3 text-sm font-bold">
             <span className="bg-surface-elevated text-foreground px-4 py-1.5 rounded-full uppercase tracking-widest border border-border shadow-sm">
                {result.session?.mode}
             </span>
             {result.session?.language === 'CODE' ? (
                <span className="text-blue-400 bg-blue-500/10 px-4 py-1.5 rounded-full uppercase tracking-widest border border-blue-500/20">
                  {result.session?.codeLanguage}
                </span>
             ) : (
                <span className="text-muted uppercase tracking-widest">
                  {result.session?.language}
                </span>
             )}
             {isVerified && (
               <span className="text-emerald-500 flex items-center gap-1.5 bg-emerald-500/10 px-4 py-1.5 rounded-full border border-emerald-500/20 shadow-glow shadow-emerald-500/20">
                 <ShieldCheck className="h-4 w-4" /> Verified
               </span>
             )}
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="bg-surface text-foreground border-border hover:bg-surface-elevated flex items-center gap-2 rounded-xl border px-6 py-3 font-bold transition-all shadow-sm"
          >
            <RefreshCw className="h-4 w-4" /> Practice Again
          </Link>
          <button
            onClick={handleShare}
            className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-xl px-6 py-3 font-bold transition-all shadow-lg shadow-accent/20"
          >
            <Share2 className="h-4 w-4" /> Share
          </button>
        </div>
      </div>

      {/* METRICS SHOWCASE */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="bg-surface border-border rounded-3xl border p-8 flex flex-col items-center justify-center text-center shadow-sm relative overflow-hidden group">
           <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity" />
           <span className="text-muted text-sm font-bold uppercase tracking-widest mb-3 flex items-center gap-2 relative z-10">
             <Activity className="h-4 w-4 text-accent" /> Net WPM
           </span>
           <span className="text-7xl font-black text-foreground relative z-10">{wpm}</span>
        </div>
        <div className="bg-surface border-border rounded-3xl border p-8 flex flex-col items-center justify-center text-center shadow-sm relative overflow-hidden group">
           <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
           <span className="text-muted text-sm font-bold uppercase tracking-widest mb-3 flex items-center gap-2 relative z-10">
             <Target className="h-4 w-4 text-emerald-500" /> Accuracy
           </span>
           <span className="text-7xl font-black text-foreground relative z-10">{accuracy}<span className="text-3xl text-muted ml-1">%</span></span>
        </div>
        <div className="bg-surface border-border rounded-3xl border p-8 flex flex-col items-center justify-center text-center shadow-sm">
           <span className="text-muted text-sm font-bold uppercase tracking-widest mb-3">
             Consistency
           </span>
           <span className="text-6xl font-black text-foreground">{consistency}<span className="text-2xl text-muted ml-1">%</span></span>
        </div>
        <div className="bg-surface border-border rounded-3xl border p-8 flex flex-col items-center justify-center text-center shadow-sm">
           <span className="text-muted text-sm font-bold uppercase tracking-widest mb-3">
             Raw WPM
           </span>
           <span className="text-6xl font-black text-muted">{rawWpm}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* PERFORMANCE GRAPH */}
        <div className="bg-surface border-border lg:col-span-2 rounded-3xl border p-8 shadow-sm">
          <h2 className="text-2xl font-bold mb-6">Speed Over Time</h2>
          {chartData.length > 0 ? (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.4} />
                  <XAxis dataKey="second" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--text-muted)" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--text-muted)" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--surface-elevated)", borderRadius: "12px", border: "1px solid var(--border)", color: "var(--foreground)", padding: "12px" }}
                    itemStyle={{ color: "var(--foreground)", fontWeight: "bold", fontSize: "16px" }}
                    labelStyle={{ color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", fontSize: "12px", letterSpacing: "1px" }}
                    formatter={(val) => [`${val} WPM`, "Speed"]}
                    labelFormatter={(val) => `Second ${val}`}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="wpm" 
                    stroke="var(--accent)" 
                    strokeWidth={4} 
                    dot={false}
                    activeDot={{ r: 8, strokeWidth: 0, fill: "var(--accent)", style: { filter: "drop-shadow(0 0 8px var(--accent))" } }} 
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[280px] w-full flex flex-col items-center justify-center border-2 border-dashed border-border rounded-2xl bg-background/50">
              <Activity className="h-8 w-8 text-muted mb-3 opacity-50" />
              <p className="text-muted font-bold tracking-wide">Timeline data not available</p>
            </div>
          )}
        </div>

        {/* ERROR ANALYSIS */}
        <div className="space-y-6 flex flex-col">
          <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm flex-1">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
               <AlertTriangle className="h-5 w-5 text-warning" /> Weak Keys
            </h2>
            {weakKeys.length > 0 ? (
              <div className="space-y-3">
                {weakKeys.map((wk, i) => (
                  <div key={i} className="flex items-center justify-between bg-background border border-border p-3.5 rounded-2xl hover:border-warning/50 transition-colors">
                    <kbd className="bg-surface-elevated px-4 py-1.5 rounded-lg font-mono text-xl font-black border border-border text-foreground shadow-sm">
                      {wk.key === ' ' ? 'Space' : wk.key}
                    </kbd>
                    <div className="flex flex-col items-end">
                      <span className="text-sm font-bold text-foreground">{wk.count}</span>
                      <span className="text-[10px] text-muted font-bold uppercase tracking-widest">misses</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10">
                <ShieldCheck className="h-12 w-12 text-emerald-500 mx-auto mb-4 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]" />
                <p className="text-sm font-bold text-emerald-500/80">Flawless typing!</p>
                <p className="text-xs font-medium text-muted mt-1">Zero mistakes made.</p>
              </div>
            )}
          </div>
          
          <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm">
            <h2 className="text-xl font-bold mb-5">Keystroke Breakdown</h2>
            <div className="space-y-4 text-sm font-bold">
               <div className="flex justify-between items-center py-1">
                 <span className="text-muted uppercase tracking-wider text-xs">Total Keystrokes</span>
                 <span className="text-lg">{result.totalKeystrokes || result.totalChars}</span>
               </div>
               <div className="flex justify-between items-center py-1">
                 <span className="text-muted uppercase tracking-wider text-xs">Correct</span>
                 <span className="text-emerald-500 text-lg">{result.correctChars}</span>
               </div>
               <div className="flex justify-between items-center py-1">
                 <span className="text-muted uppercase tracking-wider text-xs">Incorrect</span>
                 <span className="text-danger text-lg">{result.incorrectChars}</span>
               </div>
               <div className="flex justify-between items-center py-1">
                 <span className="text-muted uppercase tracking-wider text-xs">Fixed Errors</span>
                 <span className="text-orange-500 text-lg">{result.correctedErrors}</span>
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* CERTIFICATE ELIGIBILITY */}
      {result.session?.trustTier === "CERTIFICATE" && (
        <div className="bg-gradient-to-r from-surface to-surface-elevated border-border rounded-3xl border p-10 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="flex flex-col md:flex-row items-center justify-between gap-8 relative z-10">
            <div className="flex items-center gap-6">
               <div className="bg-emerald-500/10 p-5 rounded-2xl border border-emerald-500/20 shadow-glow shadow-emerald-500/20">
                 <Award className="h-10 w-10 text-emerald-500" />
               </div>
               <div>
                 <h2 className="text-2xl font-black mb-2">Certificate Eligibility</h2>
                 <p className="text-muted font-medium max-w-lg leading-relaxed">
                   {isVerified && wpm >= 40 && accuracy >= 95 
                     ? "Outstanding performance. Your verified test meets the official requirements for a TypeFlow Typing Certificate."
                     : "Keep practicing. You need a verified test with at least 40 WPM and 95% accuracy to qualify for a certificate."}
                 </p>
               </div>
            </div>
            {isVerified && wpm >= 40 && accuracy >= 95 && (
              <button className="bg-emerald-500 text-white hover:bg-emerald-400 rounded-2xl px-8 py-4 font-black tracking-wide shadow-glow shadow-emerald-500/30 whitespace-nowrap transition-all transform hover:-translate-y-1">
                Claim Certificate
              </button>
            )}
          </div>
        </div>
      )}
      
    </div>
  );
}
