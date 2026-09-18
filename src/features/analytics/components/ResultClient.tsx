"use client";

import React from "react";
import Link from "next/link";
import { Activity, ShieldCheck, Share2, RefreshCw, AlertTriangle, Target } from "lucide-react";
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
    // If we only have eventTrace, we could theoretically build the chart, but we'll fallback to a smooth flat line if needed
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
          <h1 className="text-3xl font-black mb-2">Test Complete</h1>
          <div className="flex items-center gap-4 text-sm font-medium">
             <span className="bg-surface-elevated text-foreground px-3 py-1 rounded-full uppercase tracking-widest border border-border">
                {result.session?.mode}
             </span>
             {result.session?.language === 'CODE' ? (
                <span className="text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full uppercase tracking-widest border border-blue-500/20">
                  {result.session?.codeLanguage}
                </span>
             ) : (
                <span className="text-muted uppercase tracking-widest">
                  {result.session?.language}
                </span>
             )}
             {isVerified && (
               <span className="text-emerald-500 flex items-center gap-1 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                 <ShieldCheck className="h-4 w-4" /> Verified
               </span>
             )}
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="bg-surface text-foreground border-border hover:bg-surface-elevated flex items-center gap-2 rounded-xl border px-5 py-2.5 font-bold transition-all"
          >
            <RefreshCw className="h-4 w-4" /> Play Again
          </Link>
          <button
            onClick={handleShare}
            className="bg-accent text-accent-foreground hover:bg-accent/90 flex items-center gap-2 rounded-xl px-5 py-2.5 font-bold transition-all shadow-lg shadow-accent/20"
          >
            <Share2 className="h-4 w-4" /> Share
          </button>
        </div>
      </div>

      {/* METRICS SHOWCASE */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface border-border rounded-3xl border p-6 flex flex-col items-center justify-center text-center shadow-sm">
           <span className="text-muted text-sm font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
             <Activity className="h-4 w-4" /> WPM
           </span>
           <span className="text-6xl font-black text-foreground">{wpm}</span>
        </div>
        <div className="bg-surface border-border rounded-3xl border p-6 flex flex-col items-center justify-center text-center shadow-sm">
           <span className="text-muted text-sm font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
             <Target className="h-4 w-4" /> Accuracy
           </span>
           <span className="text-6xl font-black text-foreground">{accuracy}<span className="text-3xl text-muted">%</span></span>
        </div>
        <div className="bg-surface border-border rounded-3xl border p-6 flex flex-col items-center justify-center text-center shadow-sm">
           <span className="text-muted text-sm font-bold uppercase tracking-widest mb-2">
             Consistency
           </span>
           <span className="text-6xl font-black text-foreground">{consistency}<span className="text-3xl text-muted">%</span></span>
        </div>
        <div className="bg-surface border-border rounded-3xl border p-6 flex flex-col items-center justify-center text-center shadow-sm">
           <span className="text-muted text-sm font-bold uppercase tracking-widest mb-2">
             Raw WPM
           </span>
           <span className="text-6xl font-black text-muted">{rawWpm}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* PERFORMANCE GRAPH */}
        <div className="bg-surface border-border lg:col-span-2 rounded-3xl border p-8 shadow-sm">
          <h2 className="text-xl font-bold mb-6">Speed Over Time</h2>
          {chartData.length > 0 ? (
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.4} />
                  <XAxis dataKey="second" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--text-muted)" }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--text-muted)" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--surface-elevated)", borderRadius: "12px", border: "1px solid var(--border)", color: "var(--foreground)" }}
                    itemStyle={{ color: "var(--foreground)", fontWeight: "bold" }}
                    labelStyle={{ color: "var(--text-muted)", marginBottom: "4px" }}
                    formatter={(val) => [`${val} WPM`, "Speed"]}
                    labelFormatter={(val) => `Second ${val}`}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="wpm" 
                    stroke="var(--accent)" 
                    strokeWidth={3} 
                    dot={false}
                    activeDot={{ r: 6, strokeWidth: 0, fill: "var(--accent)" }} 
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[250px] w-full flex items-center justify-center border-2 border-dashed border-border rounded-xl">
              <p className="text-muted font-medium">Timeline data not available for this test.</p>
            </div>
          )}
        </div>

        {/* ERROR ANALYSIS */}
        <div className="space-y-6">
          <div className="bg-surface border-border rounded-3xl border p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
               <AlertTriangle className="h-5 w-5 text-warning" /> Weak Keys
            </h2>
            {weakKeys.length > 0 ? (
              <div className="space-y-3">
                {weakKeys.map((wk, i) => (
                  <div key={i} className="flex items-center justify-between bg-background border border-border p-3 rounded-xl">
                    <kbd className="bg-surface-elevated px-3 py-1 rounded font-mono text-lg font-bold border border-border">
                      {wk.key === ' ' ? 'Space' : wk.key}
                    </kbd>
                    <span className="text-sm text-muted font-medium">{wk.count} misses</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <ShieldCheck className="h-10 w-10 text-emerald-500 mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium text-muted">Perfect accuracy! No mistakes made.</p>
              </div>
            )}
          </div>
          
          <div className="bg-surface border-border rounded-3xl border p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-4">Character Stats</h2>
            <div className="space-y-3 text-sm font-medium">
               <div className="flex justify-between items-center py-2 border-b border-border/50">
                 <span className="text-muted">Total Keystrokes</span>
                 <span>{result.totalKeystrokes || result.totalChars}</span>
               </div>
               <div className="flex justify-between items-center py-2 border-b border-border/50">
                 <span className="text-muted">Correct</span>
                 <span className="text-emerald-500">{result.correctChars}</span>
               </div>
               <div className="flex justify-between items-center py-2 border-b border-border/50">
                 <span className="text-muted">Incorrect</span>
                 <span className="text-danger">{result.incorrectChars}</span>
               </div>
               <div className="flex justify-between items-center py-2">
                 <span className="text-muted">Fixed Errors</span>
                 <span className="text-orange-500">{result.correctedErrors}</span>
               </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
