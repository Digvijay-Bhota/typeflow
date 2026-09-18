"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Keyboard,
  Activity,
  Target,
  Award,
  ArrowRight,
  Flame,
  Code2,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts";
import { EmptyState } from "@/components/EmptyState";

function formatTime(ms: number) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function DashboardClient({ stats, user }: { stats: any; user: any }) {
  const [chartPeriod, setChartPeriod] = useState(30);

  if (!stats || stats.totalTests === 0) {
    return (
      <div className="animate-fade-in space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome to TypeFlow, {user.email?.split("@")[0]}
          </h1>
          <p className="text-muted text-lg">Your typing journey starts here.</p>
        </div>
        <EmptyState
          title="No completed tests yet"
          description="Take your first typing test to unlock your personal performance dashboard, weak key analysis, and historical trends."
          actionText="Take a Typing Test"
          actionHref="/"
          icon={<Keyboard className="h-8 w-8" />}
        />

        {/* Placeholder previews to show what they will get */}
        <div className="pointer-events-none mt-12 space-y-8 opacity-50 grayscale filter transition-all duration-1000">
          <h3 className="mb-8 text-center text-xl font-semibold">
            What you&apos;ll unlock
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-surface border-border h-32 rounded-2xl border p-6 blur-[2px]"
              />
            ))}
          </div>
          <div className="bg-surface border-border h-64 rounded-2xl border p-6 blur-[3px]" />
        </div>
      </div>
    );
  }

  // Transform data for charts
  const rawChartData = [...stats.recentResults].reverse();
  const chartData = rawChartData.slice(-chartPeriod).map((r: any, i: number) => ({
    name: `Test ${i + 1}`,
    wpm: Math.round(r.wpm),
    accuracy: Math.round(r.accuracy * 100),
    date: new Date(r.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));

  const latestWpm = chartData.length > 0 ? chartData[chartData.length - 1]?.wpm || 0 : 0;
  const previousWpm =
    chartData.length > 1 ? chartData[chartData.length - 2]?.wpm || latestWpm : latestWpm;
  const wpmTrend = latestWpm - previousWpm;

  return (
    <div className="animate-fade-in space-y-8 pb-12">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Good to see you, {user.email?.split("@")[0]}
          </h1>
          <p className="text-muted text-lg">
            {wpmTrend > 0
              ? `You're improving! Your WPM is up by ${wpmTrend} since your last test.`
              : "Keep practicing to improve your speed and accuracy."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-accent/20 flex items-center gap-2 rounded-full px-6 py-2.5 font-bold shadow-lg transition-all"
          >
            Start Test <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* Top Metrics Grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="bg-surface border-border rounded-2xl border p-5 shadow-sm transition-transform hover:-translate-y-1">
          <div className="text-muted mb-3 flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4" /> Average WPM
          </div>
          <div className="text-3xl font-black">{Math.round(stats.avgWpm)}</div>
        </div>
        <div className="bg-surface border-border rounded-2xl border p-5 shadow-sm transition-transform hover:-translate-y-1">
          <div className="text-muted mb-3 flex items-center gap-2 text-sm font-medium">
            <Target className="h-4 w-4" /> Avg Accuracy
          </div>
          <div className="text-3xl font-black">
            {Math.round(stats.avgAccuracy * 100)}%
          </div>
        </div>
        <div className="bg-surface border-border rounded-2xl border p-5 shadow-sm transition-transform hover:-translate-y-1">
          <div className="text-muted mb-3 flex items-center gap-2 text-sm font-medium">
            <Award className="h-4 w-4" /> Personal Best
          </div>
          <div className="text-3xl font-black text-emerald-500">
            {Math.round(stats.maxWpm)}
          </div>
        </div>
        <div className="bg-surface border-border rounded-2xl border p-5 shadow-sm transition-transform hover:-translate-y-1">
          <div className="text-muted mb-3 flex items-center gap-2 text-sm font-medium">
            <Flame className="h-4 w-4 text-orange-500" /> Current Streak
          </div>
          <div className="text-3xl font-black text-orange-500">
            {stats.currentStreak}{" "}
            <span className="text-muted text-base font-normal">days</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Main Chart */}
        <div className="bg-surface border-border rounded-3xl border p-6 shadow-sm lg:col-span-2">
          <div className="mb-8 flex items-center justify-between">
            <div className="space-y-1">
              <h2 className="text-xl font-bold">Performance History</h2>
              <p className="text-muted text-sm">WPM and Accuracy over time</p>
            </div>
            <select
              value={chartPeriod}
              onChange={(e) => setChartPeriod(Number(e.target.value))}
              className="bg-background border-border focus:ring-accent cursor-pointer rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-1"
            >
              <option value={10}>Last 10 Tests</option>
              <option value={30}>Last 30 Tests</option>
              <option value={50}>Last 50 Tests</option>
            </select>
          </div>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorWpm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--border)"
                  opacity={0.4}
                />
                <XAxis
                  dataKey="date"
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
                  }}
                  itemStyle={{ color: "var(--foreground)", fontWeight: "bold" }}
                  labelStyle={{ color: "var(--text-muted)", marginBottom: "4px" }}
                />
                <Area
                  type="monotone"
                  dataKey="wpm"
                  name="WPM"
                  stroke="var(--accent)"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorWpm)"
                  activeDot={{ r: 6, strokeWidth: 0, fill: "var(--accent)" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Side modules */}
        <div className="space-y-6">
          {/* Weak Areas */}
          <div className="bg-surface border-border rounded-3xl border p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle className="text-warning h-5 w-5" />
              <h2 className="text-lg font-bold">Weak Keys</h2>
            </div>
            {stats.weakKeys && stats.weakKeys.length > 0 ? (
              <div className="space-y-3">
                <p className="text-muted mb-4 text-sm">Keys you miss most often:</p>
                {stats.weakKeys.map((wk: any, i: number) => (
                  <div
                    key={i}
                    className="bg-background border-border flex items-center justify-between rounded-xl border p-3"
                  >
                    <kbd className="bg-surface-elevated border-border rounded border px-3 py-1 font-mono text-lg font-bold">
                      {wk.key}
                    </kbd>
                    <span className="text-muted text-sm font-medium">
                      {wk.count} misses
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted py-6 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500 opacity-50" />
                <p className="text-sm">Not enough data to identify weak keys yet.</p>
              </div>
            )}
          </div>

          {/* Lifetime Stats */}
          <div className="bg-surface border-border rounded-3xl border p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold">Lifetime Stats</h2>
            <div className="space-y-4">
              <div className="border-border/50 flex items-center justify-between border-b py-2">
                <span className="text-muted flex items-center gap-2 text-sm">
                  <Keyboard className="h-4 w-4" /> Total Tests
                </span>
                <span className="font-bold">{stats.totalTests}</span>
              </div>
              <div className="border-border/50 flex items-center justify-between border-b py-2">
                <span className="text-muted flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4" /> Time Typing
                </span>
                <span className="font-bold">{formatTime(stats.totalTimeMs)}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-muted flex items-center gap-2 text-sm">
                  <Activity className="h-4 w-4" /> Keystrokes
                </span>
                <span className="font-bold">
                  {stats.totalKeystrokes.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Tests Table */}
      <div className="bg-surface border-border overflow-hidden rounded-3xl border shadow-sm">
        <div className="border-border bg-surface-elevated/30 flex items-center justify-between border-b p-6">
          <h2 className="text-xl font-bold">Recent Tests</h2>
          <Link
            href="/dashboard/history"
            className="text-accent bg-accent/10 hover:bg-accent/20 rounded-full px-4 py-2 text-sm font-bold transition-colors hover:underline"
          >
            View full history
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-background/50 text-muted text-xs font-semibold tracking-wider uppercase">
              <tr>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Mode</th>
                <th className="px-6 py-4">Language</th>
                <th className="px-6 py-4 text-right">WPM</th>
                <th className="px-6 py-4 text-right">Accuracy</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {stats.recentResults.slice(0, 8).map((r: any) => (
                <tr key={r.id} className="hover:bg-background/80 group transition-colors">
                  <td className="text-muted px-6 py-4 font-medium whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-6 py-4">
                    <span className="bg-surface-elevated text-foreground border-border rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide uppercase">
                      {r.session.mode.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {r.session.language === "CODE" ? (
                      <span className="flex w-fit items-center gap-1 rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1 font-mono text-xs font-bold text-blue-400">
                        <Code2 className="h-3 w-3" /> {r.session.codeLanguage || "CODE"}
                      </span>
                    ) : (
                      <span className="text-muted font-medium capitalize">
                        {r.session.language.toLowerCase()}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right text-base font-black">
                    {Math.round(r.wpm)}
                  </td>
                  <td className="px-6 py-4 text-right font-medium">
                    {Math.round(r.accuracy * 100)}%
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/result/${r.shareId}`}
                      className="text-accent flex items-center justify-end gap-1 font-bold opacity-0 transition-opacity group-hover:opacity-100 hover:underline"
                    >
                      View <ArrowRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
