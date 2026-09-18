"use client";

import { useState, useEffect } from "react";
import { LeaderboardEntry, LeaderboardPeriod } from "@/types/leaderboard";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { Trophy, Medal, Award, ShieldCheck } from "lucide-react";

export function LeaderboardClient() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("all-time");
  const [mode, setMode] = useState<string>("timed");
  const [language, setLanguage] = useState<string>("english");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeaderboard() {
      setLoading(true);
      const search = new URLSearchParams();
      search.set("period", period);
      search.set("mode", mode);
      search.set("language", language);

      try {
        const res = await fetch(`/api/leaderboard?${search.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setEntries(data.entries);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, [period, mode, language]);

  return (
    <div className="flex flex-col gap-10 animate-fade-in w-full max-w-5xl mx-auto">
      
      {/* Filters */}
      <div className="bg-surface border-border flex flex-wrap gap-4 rounded-2xl border p-5 shadow-sm items-center justify-between">
        <div className="flex flex-wrap gap-3">
          <select
            className="bg-background border-border focus:ring-accent rounded-xl border px-4 py-2.5 text-sm font-medium outline-none focus:ring-1 cursor-pointer transition-all"
            value={period}
            onChange={(e) => setPeriod(e.target.value as LeaderboardPeriod)}
          >
            <option value="daily">Today</option>
            <option value="weekly">This Week</option>
            <option value="all-time">All Time</option>
          </select>

          <select
            className="bg-background border-border focus:ring-accent rounded-xl border px-4 py-2.5 text-sm font-medium outline-none focus:ring-1 cursor-pointer transition-all"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="timed">Timed Test</option>
            <option value="words">Word Count</option>
            <option value="code">Code Typing</option>
          </select>

          <select
            className="bg-background border-border focus:ring-accent rounded-xl border px-4 py-2.5 text-sm font-medium outline-none focus:ring-1 cursor-pointer transition-all"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="english">English</option>
            <option value="hindi">Hindi</option>
            {mode === "code" && <option value="code">Code (Various)</option>}
          </select>
        </div>
      </div>

      <div className="bg-surface border-border overflow-hidden rounded-3xl border shadow-sm">
        <div className="overflow-x-auto min-h-[400px]">
          {loading ? (
            <div className="flex flex-col gap-4 p-8 animate-pulse">
               {[1,2,3,4,5].map(i => (
                 <div key={i} className="h-16 bg-surface-elevated rounded-xl w-full border border-border" />
               ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="p-8">
              <EmptyState 
                title="Global Leaderboard Empty" 
                description="No verified results yet for this specific category and time period. Be the first typist to set a record and claim the #1 spot!"
                actionText="Take a test and set a record"
                actionHref="/"
                icon={<Trophy className="h-8 w-8 text-yellow-500" />}
              />
            </div>
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-elevated/50 text-muted border-border border-b text-xs font-semibold uppercase tracking-wider">
                  <th className="px-6 py-4">Rank</th>
                  <th className="px-6 py-4">Typist</th>
                  <th className="px-6 py-4 text-right">Speed</th>
                  <th className="px-6 py-4 text-right">Accuracy</th>
                  <th className="px-6 py-4 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-border/50">
                {entries.map((entry) => {
                  const isFirst = entry.rank === 1;
                  const isSecond = entry.rank === 2;
                  const isThird = entry.rank === 3;
                  return (
                    <tr
                      key={entry.shareId}
                      className={`hover:bg-surface-elevated/30 transition-colors group ${isFirst ? 'bg-yellow-500/5' : isSecond ? 'bg-zinc-500/5' : isThird ? 'bg-orange-500/5' : ''}`}
                    >
                      <td className="px-6 py-5 font-bold">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-background border border-border font-mono shadow-sm">
                           {isFirst ? <Trophy className="h-4 w-4 text-yellow-500" /> : isSecond ? <Medal className="h-4 w-4 text-zinc-400" /> : isThird ? <Award className="h-4 w-4 text-orange-400" /> : <span className="text-muted text-xs">{entry.rank}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-5 font-medium">
                        <Link href={`/result/${entry.shareId}`} className="hover:text-accent font-bold text-base flex items-center gap-2">
                          {entry.displayName}
                          {entry.isCertificateEligible && (
                            <span className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-bold flex items-center gap-1">
                              <ShieldCheck className="h-3 w-3" /> Verified
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="text-foreground px-6 py-5 font-black text-right text-lg">
                        {entry.netWpm}{" "}
                        <span className="text-muted text-xs font-medium uppercase tracking-wider">WPM</span>
                      </td>
                      <td className="px-6 py-5 text-right font-medium">{(entry.accuracy * 100).toFixed(1)}%</td>
                      <td className="text-muted px-6 py-5 text-right whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
