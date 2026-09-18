"use client";

import React from "react";
import Link from "next/link";
import {
  Keyboard,
  Activity,
  TrendingUp,
  Target,
  Award,
  ArrowRight,
  Flame,
  Code2,
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

function EmptyState() {
  return (
    <div className="bg-surface border-border flex flex-col items-center justify-center rounded-2xl border px-4 py-20 text-center shadow-sm">
      <div className="bg-accent/10 mb-6 rounded-full p-4">
        <Keyboard className="text-accent h-10 w-10" />
      </div>
      <h2 className="mb-2 text-2xl font-bold">Your typing journey starts here</h2>
      <p className="text-muted mx-auto mb-8 max-w-md">
        Complete your first test to unlock WPM trends, weak-key analysis, personal
        records, and progress tracking.
      </p>
      <Link
        href="/typing-test"
        className="bg-foreground text-background flex items-center gap-2 rounded-xl px-6 py-3 font-medium transition-opacity hover:opacity-90"
      >
        Start your first test <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

export function DashboardClient({ stats, user }: { stats: any; user: any }) {
  if (!stats || stats.totalTests === 0) {
    return (
      <div className="animate-fade-in space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Good morning, {user.email?.split("@")[0]}
          </h1>
          <p className="text-muted">Welcome to your TypeFlow dashboard.</p>
        </div>
        <EmptyState />
      </div>
    );
  }

  // Transform data for charts
  const chartData = [...stats.recentResults].reverse().map((r, i) => ({
    name: `Test ${i + 1}`,
    wpm: Math.round(r.wpm),
    accuracy: Math.round(r.accuracy * 100),
    date: new Date(r.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));

  const metrics = [
    {
      label: "Tests Taken",
      value: stats.totalTests,
      icon: Activity,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Average Speed",
      value: `${Math.round(stats.avgWpm)} WPM`,
      icon: TrendingUp,
      color: "text-accent",
      bg: "bg-accent/10",
    },
    {
      label: "Best Speed",
      value: `${Math.round(stats.maxWpm)} WPM`,
      icon: Award,
      color: "text-yellow-500",
      bg: "bg-yellow-500/10",
    },
    {
      label: "Avg Accuracy",
      value: `${Math.round(stats.avgAccuracy * 100)}%`,
      icon: Target,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
  ];

  return (
    <div className="animate-fade-in space-y-8 pb-12">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted">Here is your typing performance overview.</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-surface border-border flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium">
            <Flame className="h-4 w-4 text-orange-500" />
            <span>1 Day Streak</span>
          </div>
          <Link
            href="/typing-test"
            className="bg-foreground text-background rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
          >
            Practice Now
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map((m, i) => {
          const Icon = m.icon;
          return (
            <div
              key={i}
              className="bg-surface border-border group hover:border-accent/50 flex flex-col gap-4 rounded-2xl border p-5 shadow-sm transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-muted text-sm font-medium">{m.label}</span>
                <div className={`rounded-lg p-2 ${m.bg}`}>
                  <Icon className={`h-4 w-4 ${m.color}`} />
                </div>
              </div>
              <div className="text-3xl font-bold tracking-tight">{m.value}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main Chart */}
        <div className="bg-surface border-border rounded-2xl border p-6 shadow-sm lg:col-span-2">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-lg font-bold">Performance Trend</h2>
            <select className="bg-background border-border focus:ring-accent rounded-md border px-2 py-1 text-sm outline-none focus:ring-1">
              <option>Last 10 Tests</option>
              <option>Last 30 Days</option>
            </select>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorWpm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--border)"
                  opacity={0.5}
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
                  itemStyle={{ color: "var(--foreground)" }}
                />
                <Area
                  type="monotone"
                  dataKey="wpm"
                  name="WPM"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorWpm)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Side modules */}
        <div className="space-y-6">
          {/* Consistency / Accuracy Analysis */}
          <div className="bg-surface border-border rounded-2xl border p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold">Accuracy Analysis</h2>
            <div className="space-y-4">
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-muted">Recent Accuracy</span>
                  <span className="font-medium">
                    {chartData[chartData.length - 1]?.accuracy}%
                  </span>
                </div>
                <div className="bg-background h-2 w-full overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${chartData[chartData.length - 1]?.accuracy}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-muted">Best Accuracy</span>
                  <span className="font-medium">100%</span>
                </div>
                <div className="bg-background h-2 w-full overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-surface border-border rounded-2xl border p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold">Quick Actions</h2>
            <div className="space-y-2">
              <Link
                href="/typing-test-with-certificate"
                className="border-border hover:border-accent hover:bg-accent/5 group flex items-center justify-between rounded-xl border p-3 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Award className="h-5 w-5 text-emerald-500" />
                  <span className="text-sm font-medium">Get Certified</span>
                </div>
                <ArrowRight className="text-muted group-hover:text-accent h-4 w-4 transition-colors" />
              </Link>
              <Link
                href="/code/javascript"
                className="border-border hover:border-accent hover:bg-accent/5 group flex items-center justify-between rounded-xl border p-3 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Code2 className="h-5 w-5 text-blue-500" />
                  <span className="text-sm font-medium">Practice Code</span>
                </div>
                <ArrowRight className="text-muted group-hover:text-accent h-4 w-4 transition-colors" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Tests Table */}
      <div className="bg-surface border-border overflow-hidden rounded-2xl border shadow-sm">
        <div className="border-border flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-bold">Recent Tests</h2>
          <Link
            href="/dashboard/history"
            className="text-accent text-sm font-medium hover:underline"
          >
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-background text-muted text-xs font-medium uppercase">
              <tr>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Mode</th>
                <th className="px-6 py-4">WPM</th>
                <th className="px-6 py-4">Accuracy</th>
                <th className="px-6 py-4">Duration</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {stats.recentResults.slice(0, 5).map((r: any) => (
                <tr key={r.id} className="hover:bg-background/50 transition-colors">
                  <td className="text-muted px-6 py-4 whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-6 py-4">
                    <span className="bg-accent/10 text-accent border-accent/20 rounded-md border px-2 py-1 text-xs font-medium">
                      Standard
                    </span>
                  </td>
                  <td className="px-6 py-4 font-bold">{Math.round(r.wpm)}</td>
                  <td className="px-6 py-4">{Math.round(r.accuracy * 100)}%</td>
                  <td className="text-muted px-6 py-4">
                    {(r.duration / 1000).toFixed(0)}s
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/result/${r.shareId}`}
                      className="text-accent font-medium hover:underline"
                    >
                      View
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
