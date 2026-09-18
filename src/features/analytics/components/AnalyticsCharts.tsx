"use client";

import React, { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface AnalyticsChartsProps {
  data: {
    wpm: number;
    accuracy: number;
    createdAt: Date;
    elapsedMs: number;
  }[];
}

export function AnalyticsCharts({ data }: AnalyticsChartsProps) {
  const [filter, setFilter] = useState<number>(30); // days

  // Filter Data
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - filter);
  
  const filtered = data
    .filter(d => new Date(d.createdAt) >= cutoff)
    .map(d => ({
       date: new Date(d.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
       wpm: Math.round(d.wpm),
       accuracy: Math.round(d.accuracy * 100),
       duration: Math.round(d.elapsedMs / 1000)
    }));

  return (
    <div className="flex flex-col gap-8">
      {/* FILTER TABS */}
      <div className="flex justify-between items-center bg-surface border-border p-2 rounded-2xl w-max">
        {[7, 30, 90, 365].map(days => (
          <button
            key={days}
            onClick={() => setFilter(days)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${filter === days ? 'bg-accent text-white shadow-md' : 'text-muted hover:text-foreground'}`}
          >
            {days} Days
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-surface border-border rounded-3xl border p-12 text-center text-muted font-medium">
           No test data available for the selected time range.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          
          {/* WPM CHART */}
          <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm">
            <h2 className="text-2xl font-bold mb-6">Typing Speed (WPM)</h2>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filtered} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorWpm" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.4} />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--text-muted)" }} dy={10} minTickGap={30} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--text-muted)" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--surface-elevated)", borderRadius: "12px", border: "1px solid var(--border)" }}
                    itemStyle={{ color: "var(--foreground)", fontWeight: "bold" }}
                  />
                  <Area type="monotone" dataKey="wpm" name="WPM" stroke="var(--accent)" strokeWidth={3} fillOpacity={1} fill="url(#colorWpm)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ACCURACY CHART */}
          <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm">
            <h2 className="text-2xl font-bold mb-6">Accuracy %</h2>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filtered} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAcc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.4} />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--text-muted)" }} dy={10} minTickGap={30} />
                  <YAxis domain={['auto', 100]} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "var(--text-muted)" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--surface-elevated)", borderRadius: "12px", border: "1px solid var(--border)" }}
                    itemStyle={{ color: "var(--foreground)", fontWeight: "bold" }}
                  />
                  <Area type="monotone" dataKey="accuracy" name="Accuracy %" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorAcc)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
