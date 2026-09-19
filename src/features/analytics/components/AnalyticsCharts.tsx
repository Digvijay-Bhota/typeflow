"use client";

import React, { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Lightbulb } from "lucide-react";

interface AnalyticsChartsProps {
  data: {
    date: string;
    wpm: number;
    maxWpm: number;
    accuracy: number;
    count: number;
  }[];
  insights: string[];
}

export function AnalyticsCharts({ data, insights }: AnalyticsChartsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentRange = searchParams.get("range") || "30";
  const currentMode = searchParams.get("mode") || "ENGLISH";
  const currentTz = searchParams.get("tz");

  const setFilter = React.useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    router.push(`?${params.toString()}`);
  }, [searchParams, router]);

  useEffect(() => {
    if (!currentTz) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        setFilter("tz", tz);
      } catch {
        // Fallback to UTC if timezone detection fails
      }
    }
  }, [currentTz, setFilter]);

  const formattedData = data.map((d) => ({
    ...d,
    dateLabel: new Date(d.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    wpm: Math.round(d.wpm),
    accuracy: Math.round(d.accuracy * 100),
  }));

  return (
    <div className="flex flex-col gap-8">
      {/* FILTER TABS */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="bg-surface border-border flex w-max items-center rounded-2xl border p-1 shadow-sm">
          {["ENGLISH", "CODE", "PRACTICE"].map((mode) => (
            <button
              key={mode}
              onClick={() => setFilter("mode", mode)}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition-all ${
                currentMode === mode
                  ? "bg-foreground text-background shadow-md"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {mode === "ENGLISH" ? "Standard" : mode === "CODE" ? "Code" : "Practice"}
            </button>
          ))}
        </div>

        <div className="bg-surface border-border flex w-max items-center rounded-2xl border p-1 shadow-sm">
          {[
            { label: "7 Days", value: "7" },
            { label: "30 Days", value: "30" },
            { label: "90 Days", value: "90" },
            { label: "All Time", value: "all" },
          ].map((range) => (
            <button
              key={range.value}
              onClick={() => setFilter("range", range.value)}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition-all ${
                currentRange === range.value
                  ? "bg-accent text-white shadow-md"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {insights.length > 0 && (
        <div className="bg-surface border-accent/20 flex flex-col gap-3 rounded-3xl border p-6 shadow-sm">
          <div className="text-accent flex items-center gap-2 font-black">
            <Lightbulb className="h-5 w-5" />
            Performance Insights
          </div>
          <ul className="text-foreground flex flex-col gap-2 text-sm font-medium">
            {insights.map((insight, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-accent mt-1 block h-1.5 w-1.5 rounded-full" />
                {insight}
              </li>
            ))}
          </ul>
        </div>
      )}

      {formattedData.length === 0 ? (
        <div className="bg-surface border-border text-muted rounded-3xl border p-12 text-center font-medium shadow-sm">
          No test data available for the selected filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8">
          {/* WPM CHART */}
          <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm">
            <h2 className="mb-6 text-2xl font-bold">Typing Speed (WPM)</h2>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={formattedData}
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
                    opacity={0.4}
                  />
                  <XAxis
                    dataKey="dateLabel"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                    dy={10}
                    minTickGap={30}
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
                    }}
                    itemStyle={{ color: "var(--foreground)", fontWeight: "bold" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="wpm"
                    name="Avg WPM"
                    stroke="var(--accent)"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorWpm)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ACCURACY CHART */}
          <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm">
            <h2 className="mb-6 text-2xl font-bold">Accuracy %</h2>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={formattedData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorAcc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--border)"
                    opacity={0.4}
                  />
                  <XAxis
                    dataKey="dateLabel"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                    dy={10}
                    minTickGap={30}
                  />
                  <YAxis
                    domain={[0, 100]}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--surface-elevated)",
                      borderRadius: "12px",
                      border: "1px solid var(--border)",
                    }}
                    itemStyle={{ color: "var(--foreground)", fontWeight: "bold" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="accuracy"
                    name="Accuracy %"
                    stroke="#10b981"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorAcc)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
