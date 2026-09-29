import React from "react";
import { ResponsiveContainer, LineChart, Line, YAxis } from "recharts";

export function Sparkline({ data }: { data: { wpm: number }[] }) {
  if (!data || data.length === 0) return null;

  return (
    <div className="h-10 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <YAxis domain={["dataMin - 10", "dataMax + 10"]} hide />
          <Line
            type="monotone"
            dataKey="wpm"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
