"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface ActivityHeatmapProps {
  data: Record<string, number>; // "YYYY-MM-DD" -> count
}

export function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  // Generate last 365 days
  const today = new Date();
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  // Create columns of 7 days (weeks)
  const weeks = [];
  let currentWeek = [];
  for (let i = 0; i < days.length; i++) {
    currentWeek.push(days[i]);
    const day = days[i];
    if (day && (day.getDay() === 0 || i === days.length - 1)) {
      // Sunday or last day
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  const getIntensityClass = (count: number) => {
    if (count === 0) return "bg-surface-elevated/30 border-border/50";
    if (count <= 2) return "bg-accent/30 border-accent/20";
    if (count <= 5) return "bg-accent/60 border-accent/40";
    if (count <= 10) return "bg-accent border-accent shadow-glow shadow-accent/20";
    return "bg-cyan-400 border-cyan-400 shadow-glow shadow-cyan-400/40";
  };

  return (
    <div className="custom-scrollbar w-full overflow-x-auto pb-4">
      <div className="inline-flex gap-1">
        {weeks.map((week, wIdx) => (
          <div key={wIdx} className="flex flex-col gap-1">
            {week.map((day, dIdx) => {
              if (!day) return null;
              const dateStr = day.toISOString().split("T")[0] as string;
              const count = data[dateStr] || 0;
              return (
                <div
                  key={dIdx}
                  title={`${dateStr}: ${count} tests`}
                  className={cn(
                    "hover:border-foreground h-3 w-3 cursor-crosshair rounded-sm border transition-colors",
                    getIntensityClass(count)
                  )}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="text-muted mt-4 flex items-center justify-between text-xs font-semibold tracking-wider uppercase">
        <span>1 Year Ago</span>
        <div className="flex items-center gap-2">
          Less
          <div className="flex gap-1">
            <div className="bg-surface-elevated/30 border-border/50 h-3 w-3 rounded-sm border" />
            <div className="bg-accent/30 border-accent/20 h-3 w-3 rounded-sm border" />
            <div className="bg-accent/60 border-accent/40 h-3 w-3 rounded-sm border" />
            <div className="bg-accent border-accent h-3 w-3 rounded-sm border" />
            <div className="h-3 w-3 rounded-sm border border-cyan-400 bg-cyan-400" />
          </div>
          More
        </div>
      </div>
    </div>
  );
}
