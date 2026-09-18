"use client";

import { useState, useEffect } from "react";
import { LeaderboardEntry, LeaderboardPeriod } from "@/types/leaderboard";
import Link from "next/link";

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
    <div className="flex flex-col gap-6">
      <div className="bg-tf-background-100 border-border flex flex-wrap gap-4 rounded-xl border p-4">
        <select
          className="bg-tf-background-50 border-tf-neutral-700 rounded-md border px-3 py-1.5 text-sm"
          value={period}
          onChange={(e) => setPeriod(e.target.value as LeaderboardPeriod)}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="all-time">All Time</option>
        </select>

        <select
          className="bg-tf-background-50 border-tf-neutral-700 rounded-md border px-3 py-1.5 text-sm"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="timed">Timed</option>
          <option value="words">Words</option>
          <option value="code">Code</option>
        </select>

        <select
          className="bg-tf-background-50 border-tf-neutral-700 rounded-md border px-3 py-1.5 text-sm"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="english">English</option>
          <option value="hindi">Hindi</option>
          {mode === "code" && <option value="code">Code</option>}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-border text-muted border-b text-sm">
              <th className="px-4 py-3 font-medium">Rank</th>
              <th className="px-4 py-3 font-medium">Typist</th>
              <th className="px-4 py-3 font-medium">Speed</th>
              <th className="px-4 py-3 font-medium">Accuracy</th>
              <th className="px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {loading ? (
              <tr>
                <td colSpan={5} className="text-muted py-8 text-center">
                  Loading...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted py-8 text-center">
                  No results found
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr
                  key={entry.shareId}
                  className="border-border/50 hover:bg-tf-background-100/50 border-b transition-colors"
                >
                  <td className="text-muted px-4 py-4 font-mono">#{entry.rank}</td>
                  <td className="px-4 py-4 font-medium">
                    <Link href={`/result/${entry.shareId}`} className="hover:text-accent">
                      {entry.displayName}
                      {entry.isCertificateEligible && (
                        <span className="bg-accent/20 text-accent border-tf-primary-500/30 ml-2 rounded border px-1.5 py-0.5 text-xs">
                          VERIFIED
                        </span>
                      )}
                    </Link>
                  </td>
                  <td className="text-foreground dark:text-foreground px-4 py-4 font-bold">
                    {entry.netWpm}{" "}
                    <span className="text-muted text-xs font-normal">WPM</span>
                  </td>
                  <td className="px-4 py-4">{(entry.accuracy * 100).toFixed(1)}%</td>
                  <td className="text-muted px-4 py-4">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
