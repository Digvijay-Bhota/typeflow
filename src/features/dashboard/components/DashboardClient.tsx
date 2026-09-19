"use client";

import React from "react";
import Link from "next/link";
import {
  Keyboard,
  Target,
  Trophy,
  Flame,
  Clock,
  Zap,
  ChevronRight,
  TrendingUp,
  BarChart2,
  CalendarDays,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { EmptyState } from "@/components/EmptyState";

interface DashboardStats {
  totalTests: number;
  avgWpm: number;
  maxWpm: number;
  avgAccuracy: number;
  totalTimeMs: number;
  totalKeystrokes: number;
  currentStreak: number;
  weakKeys: { key: string; count: number }[];
  languageBreakdown: Record<string, number>;
  recentResults: any[];
}

export function DashboardClient({ stats, user }: { stats: DashboardStats; user: any }) {
  if (stats.totalTests === 0) {
    return (
      <div className="animate-fade-in mx-auto flex w-full max-w-6xl flex-col gap-6">
        <h1 className="mb-2 text-4xl font-black tracking-tight">
          Welcome, {user?.displayName || "Typist"}
        </h1>
        <EmptyState
          title="Your typing journey starts here"
          description="Complete your first test to unlock performance trends, weak-key analysis, achievements, and your personal records."
          icon={<Keyboard className="text-accent h-10 w-10" />}
          actionText="Start Typing →"
          actionHref="/typing-test"
        />
      </div>
    );
  }

  // Calculate trends for KPI cards (using recent 30 as baseline)
  const chartData = [...stats.recentResults].reverse().map((r, i) => ({
    name: `Test ${i + 1}`,
    wpm: Math.round(r.wpm),
    accuracy: Math.round(r.accuracy * 100),
    rawWpm: Math.round(r.rawWpm || r.wpm),
  }));

  const latestWpm = chartData.length > 0 ? chartData[chartData.length - 1]?.wpm || 0 : 0;
  const previousWpm =
    chartData.length > 1 ? chartData[chartData.length - 2]?.wpm || latestWpm : latestWpm;
  const wpmTrend = latestWpm - previousWpm;

  // Goals
  const dailyTests = stats.recentResults.filter((r) => {
    const today = new Date().toDateString();
    return new Date(r.createdAt).toDateString() === today;
  }).length;
  const dailyGoal = 5;
  const goalProgress = Math.min((dailyTests / dailyGoal) * 100, 100);

  return (
    <div className="animate-fade-in mx-auto flex w-full max-w-6xl flex-col gap-10 pb-12">
      {/* HERO SECTION */}
      <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div className="bg-accent/10 absolute -z-10 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"></div>
        <div>
          <h1 className="mb-2 text-4xl font-black tracking-tight">
            Welcome back, {user?.displayName || "Typist"}
          </h1>
          <p className="text-muted flex items-center gap-2 font-medium">
            Keep Typing. Keep Growing. <Flame className="h-4 w-4 text-orange-500" />{" "}
            {stats.currentStreak} Day Streak
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/analytics"
            className="bg-surface text-foreground hover:bg-surface-elevated border-border flex items-center gap-2 rounded-xl border px-6 py-3 font-bold shadow-sm transition-all"
          >
            <BarChart2 className="text-accent h-4 w-4" /> Full Analytics
          </Link>
          <Link
            href="/typing-test"
            className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-accent/20 flex items-center gap-2 rounded-xl px-6 py-3 font-bold shadow-lg transition-all"
          >
            Practice Now <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* DYNAMIC PERFORMANCE INSIGHT */}
      {chartData.length > 1 && (
        <div className="bg-accent/5 border-accent/20 text-foreground flex items-center gap-3 rounded-2xl border p-4 shadow-sm">
          <Zap
            className={`h-5 w-5 ${wpmTrend >= 0 ? "text-emerald-500" : "text-orange-500"}`}
          />
          <p className="text-sm font-medium">
            {wpmTrend >= 0
              ? `Great progress! Your speed has improved by ${wpmTrend} WPM compared to your previous test.`
              : `Your speed dropped by ${Math.abs(wpmTrend)} WPM. Take a deep breath and focus on accuracy for your next run.`}
          </p>
        </div>
      )}

      {/* KPI METRICS */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <div className="group bg-surface hover:bg-surface-elevated hover:border-accent/30 border-border flex flex-col rounded-3xl border p-6 shadow-sm transition-all duration-300">
          <span className="text-muted mb-3 flex items-center gap-2 text-xs font-bold tracking-widest uppercase">
            <Zap className="text-accent h-4 w-4" /> Avg Speed
          </span>
          <span className="text-foreground text-4xl font-black">
            {Math.round(stats.avgWpm)}
          </span>
          <span
            className={`mt-2 flex items-center gap-1 text-xs font-bold ${wpmTrend >= 0 ? "text-emerald-500" : "text-danger"}`}
          >
            <TrendingUp className={`h-3 w-3 ${wpmTrend < 0 && "rotate-180"}`} />{" "}
            {Math.abs(wpmTrend)} WPM
          </span>
        </div>
        <div className="group bg-surface hover:bg-surface-elevated hover:border-accent/30 border-border flex flex-col rounded-3xl border p-6 shadow-sm transition-all duration-300">
          <span className="text-muted mb-3 flex items-center gap-2 text-xs font-bold tracking-widest uppercase">
            <Trophy className="h-4 w-4 text-yellow-500" /> Best WPM
          </span>
          <span className="text-foreground text-4xl font-black">
            {Math.round(stats.maxWpm)}
          </span>
          <span className="text-muted mt-2 text-xs font-bold uppercase">
            All Time High
          </span>
        </div>
        <div className="group bg-surface hover:bg-surface-elevated hover:border-accent/30 border-border flex flex-col rounded-3xl border p-6 shadow-sm transition-all duration-300">
          <span className="text-muted mb-3 flex items-center gap-2 text-xs font-bold tracking-widest uppercase">
            <Target className="h-4 w-4 text-emerald-500" /> Accuracy
          </span>
          <span className="text-foreground text-4xl font-black">
            {Math.round(stats.avgAccuracy * 100)}%
          </span>
          <span className="text-muted mt-2 text-xs font-bold uppercase">Lifetime</span>
        </div>
        <div className="group bg-surface hover:bg-surface-elevated hover:border-accent/30 border-border flex flex-col rounded-3xl border p-6 shadow-sm transition-all duration-300">
          <span className="text-muted mb-3 flex items-center gap-2 text-xs font-bold tracking-widest uppercase">
            <Keyboard className="h-4 w-4 text-blue-400" /> Tests
          </span>
          <span className="text-foreground text-4xl font-black">{stats.totalTests}</span>
          <span className="text-muted mt-2 text-xs font-bold uppercase">Completed</span>
        </div>
        <div className="group bg-surface hover:bg-surface-elevated hover:border-accent/30 border-border flex flex-col rounded-3xl border p-6 shadow-sm transition-all duration-300">
          <span className="text-muted mb-3 flex items-center gap-2 text-xs font-bold tracking-widest uppercase">
            <Flame className="h-4 w-4 text-orange-500" /> Streak
          </span>
          <span className="text-foreground text-4xl font-black">
            {stats.currentStreak}
          </span>
          <span className="text-muted mt-2 text-xs font-bold uppercase">Active Days</span>
        </div>
        <div className="group bg-surface hover:bg-surface-elevated hover:border-accent/30 border-border flex flex-col rounded-3xl border p-6 shadow-sm transition-all duration-300">
          <span className="text-muted mb-3 flex items-center gap-2 text-xs font-bold tracking-widest uppercase">
            <Clock className="h-4 w-4 text-purple-400" /> Time
          </span>
          <span className="text-foreground text-4xl font-black">
            {Math.round(stats.totalTimeMs / 60000)}
            <span className="text-muted ml-1 text-lg uppercase">m</span>
          </span>
          <span className="text-muted mt-2 text-xs font-bold uppercase">Practiced</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* RECENT PERFORMANCE TREND */}
        <div className="bg-surface border-border flex flex-col rounded-3xl border p-8 shadow-sm lg:col-span-2">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Performance Trend</h2>
              <p className="text-muted text-sm font-medium">
                Your last {chartData.length} test results
              </p>
            </div>
          </div>
          <div className="mt-auto h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
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
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                  dy={10}
                  minTickGap={20}
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
                  labelStyle={{ display: "none" }}
                />
                <Area
                  type="monotone"
                  dataKey="wpm"
                  name="WPM"
                  stroke="var(--accent)"
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorTrend)"
                />
                <Area
                  type="monotone"
                  dataKey="rawWpm"
                  name="Raw WPM"
                  stroke="var(--text-muted)"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  fill="none"
                  opacity={0.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* GOALS AND INSIGHTS */}
        <div className="flex flex-col gap-6">
          <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm">
            <h2 className="mb-6 flex items-center gap-2 text-xl font-bold">
              <CalendarDays className="text-accent h-5 w-5" /> Daily Goal
            </h2>
            <div className="text-muted mb-2 flex justify-between text-sm font-bold tracking-widest uppercase">
              <span>Tests</span>
              <span>
                {dailyTests} / {dailyGoal}
              </span>
            </div>
            <div className="bg-background border-border h-3 w-full overflow-hidden rounded-full border">
              <div
                className="bg-accent h-full transition-all duration-1000 ease-out"
                style={{ width: `${goalProgress}%` }}
              />
            </div>
            <p className="text-foreground mt-4 text-sm font-medium">
              {dailyTests >= dailyGoal
                ? "Daily goal reached! Great job."
                : `Complete ${dailyGoal - dailyTests} more tests to hit your daily goal.`}
            </p>
          </div>

          <div className="bg-surface border-border flex-1 rounded-3xl border p-8 shadow-sm">
            <h2 className="mb-6 text-xl font-bold">Weak Keys</h2>
            {stats.weakKeys.length > 0 ? (
              <div className="space-y-4">
                {stats.weakKeys.slice(0, 4).map((wk, i) => (
                  <div key={i} className="group flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <kbd className="bg-surface-elevated text-foreground border-border group-hover:border-warning/50 flex h-10 w-10 items-center justify-center rounded-xl border font-mono text-lg font-black shadow-sm transition-colors">
                        {wk.key === " " ? "_" : wk.key.toUpperCase()}
                      </kbd>
                    </div>
                    <span className="text-muted text-sm font-bold tracking-wider uppercase">
                      {wk.count} Errors
                    </span>
                  </div>
                ))}
                <Link
                  href="/practice"
                  className="text-accent hover:text-accent/80 mt-4 block text-center text-sm font-bold"
                >
                  Practice Keys →
                </Link>
              </div>
            ) : (
              <p className="text-muted text-sm font-medium">Not enough error data yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
