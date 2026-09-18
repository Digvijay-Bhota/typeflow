"use client";

import React from "react";
import Link from "next/link";
import { Keyboard, Activity, TrendingUp, Target, Award, ArrowRight, Flame, Code2 } from "lucide-react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart } from "recharts";

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-surface border border-border rounded-2xl shadow-sm">
      <div className="bg-accent/10 p-4 rounded-full mb-6">
        <Keyboard className="w-10 h-10 text-accent" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Your typing journey starts here</h2>
      <p className="text-muted max-w-md mx-auto mb-8">
        Complete your first test to unlock WPM trends, weak-key analysis, personal records, and progress tracking.
      </p>
      <Link 
        href="/typing-test"
        className="flex items-center gap-2 px-6 py-3 bg-foreground text-background font-medium rounded-xl hover:opacity-90 transition-opacity"
      >
        Start your first test <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

export function DashboardClient({ stats, user }: { stats: any; user: any }) {
  if (!stats || stats.totalTests === 0) {
    return (
      <div className="animate-fade-in space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Good morning, {user.email?.split('@')[0]}</h1>
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
    date: new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }));

  const metrics = [
    { label: "Tests Taken", value: stats.totalTests, icon: Activity, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Average Speed", value: `${Math.round(stats.avgWpm)} WPM`, icon: TrendingUp, color: "text-accent", bg: "bg-accent/10" },
    { label: "Best Speed", value: `${Math.round(stats.maxWpm)} WPM`, icon: Award, color: "text-yellow-500", bg: "bg-yellow-500/10" },
    { label: "Avg Accuracy", value: `${Math.round(stats.avgAccuracy * 100)}%`, icon: Target, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  ];

  return (
    <div className="animate-fade-in space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted">Here is your typing performance overview.</p>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-border rounded-lg text-sm font-medium">
            <Flame className="w-4 h-4 text-orange-500" />
            <span>1 Day Streak</span>
          </div>
          <Link href="/typing-test" className="px-4 py-2 bg-foreground text-background text-sm font-medium rounded-lg hover:opacity-90 transition-opacity">
            Practice Now
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m, i) => {
          const Icon = m.icon;
          return (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5 shadow-sm flex flex-col gap-4 group hover:border-accent/50 transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted">{m.label}</span>
                <div className={`p-2 rounded-lg ${m.bg}`}>
                  <Icon className={`w-4 h-4 ${m.color}`} />
                </div>
              </div>
              <div className="text-3xl font-bold tracking-tight">{m.value}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart */}
        <div className="lg:col-span-2 bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-bold text-lg">Performance Trend</h2>
            <select className="bg-background border border-border rounded-md text-sm px-2 py-1 outline-none focus:ring-1 focus:ring-accent">
              <option>Last 10 Tests</option>
              <option>Last 30 Days</option>
            </select>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorWpm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
                <XAxis 
                  dataKey="date" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: 'var(--text-muted)' }} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--surface-elevated)', borderRadius: '12px', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                  itemStyle={{ color: 'var(--foreground)' }}
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
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
            <h2 className="font-bold text-lg mb-4">Accuracy Analysis</h2>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted">Recent Accuracy</span>
                  <span className="font-medium">{chartData[chartData.length - 1]?.accuracy}%</span>
                </div>
                <div className="w-full bg-background rounded-full h-2 overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${chartData[chartData.length - 1]?.accuracy}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-muted">Best Accuracy</span>
                  <span className="font-medium">100%</span>
                </div>
                <div className="w-full bg-background rounded-full h-2 overflow-hidden">
                  <div className="bg-blue-500 h-full rounded-full transition-all" style={{ width: '100%' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-surface border border-border rounded-2xl p-6 shadow-sm">
            <h2 className="font-bold text-lg mb-4">Quick Actions</h2>
            <div className="space-y-2">
              <Link href="/typing-test-with-certificate" className="flex items-center justify-between p-3 rounded-xl border border-border hover:border-accent hover:bg-accent/5 transition-colors group">
                <div className="flex items-center gap-3">
                  <Award className="w-5 h-5 text-emerald-500" />
                  <span className="font-medium text-sm">Get Certified</span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted group-hover:text-accent transition-colors" />
              </Link>
              <Link href="/code/javascript" className="flex items-center justify-between p-3 rounded-xl border border-border hover:border-accent hover:bg-accent/5 transition-colors group">
                <div className="flex items-center gap-3">
                  <Code2 className="w-5 h-5 text-blue-500" />
                  <span className="font-medium text-sm">Practice Code</span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted group-hover:text-accent transition-colors" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Tests Table */}
      <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border flex justify-between items-center">
          <h2 className="font-bold text-lg">Recent Tests</h2>
          <Link href="/dashboard/history" className="text-sm font-medium text-accent hover:underline">View all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-background text-muted text-xs uppercase font-medium">
              <tr>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Mode</th>
                <th className="px-6 py-4">WPM</th>
                <th className="px-6 py-4">Accuracy</th>
                <th className="px-6 py-4">Duration</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.recentResults.slice(0, 5).map((r: any) => (
                <tr key={r.id} className="hover:bg-background/50 transition-colors">
                  <td className="px-6 py-4 text-muted whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 rounded-md bg-accent/10 text-accent text-xs font-medium border border-accent/20">
                      Standard
                    </span>
                  </td>
                  <td className="px-6 py-4 font-bold">{Math.round(r.wpm)}</td>
                  <td className="px-6 py-4">{Math.round(r.accuracy * 100)}%</td>
                  <td className="px-6 py-4 text-muted">{(r.duration / 1000).toFixed(0)}s</td>
                  <td className="px-6 py-4 text-right">
                    <Link href={`/result/${r.shareId}`} className="font-medium text-accent hover:underline">View</Link>
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
