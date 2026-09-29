"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatTrendValue,
  percentAxis,
  type TrendPoint,
  type TrendUnit,
} from "../lib/trend";

type TrendChartProps = {
  points: TrendPoint[];
  /** Name of the plotted value, e.g. "Average WPM". */
  seriesName: string;
  /** Header of the category column in the data table, e.g. "Date". */
  categoryName: string;
  unit: TrendUnit;
  /** One sentence describing what the chart shows, for screen readers. */
  summary: string;
  tone?: "accent" | "success";
};

const TICK = { fontSize: 12, fill: "var(--text-muted)" };

function ChartTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: { payload: TrendPoint }[];
  unit: TrendUnit;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-control border-border bg-surface-elevated text-foreground shadow-overlay border px-3 py-2 text-sm">
      <p className="text-secondary text-xs">{point.fullLabel}</p>
      <p className="font-semibold tabular-nums">{formatTrendValue(point.value, unit)}</p>
      {point.detail && <p className="text-muted text-xs">{point.detail}</p>}
    </div>
  );
}

/**
 * A single-series trend (area chart) with its data as a table beneath, so the
 * values are available without a pointer. Animation is off: the chart is read,
 * not watched, and this also honours reduced motion.
 */
export function TrendChart({
  points,
  seriesName,
  categoryName,
  unit,
  summary,
  tone = "accent",
}: TrendChartProps) {
  const tableId = useId();
  const color = tone === "success" ? "var(--success)" : "var(--accent)";
  const axis = unit === "percent" ? percentAxis(points.map((p) => p.value)) : null;

  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={summary} className="h-56 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tick={TICK}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              interval="preserveStartEnd"
            />
            <YAxis
              width={40}
              tick={TICK}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              {...(axis
                ? { domain: axis.domain, ticks: axis.ticks }
                : { domain: ["auto", "auto"] })}
            />
            <Tooltip
              content={<ChartTooltip unit={unit} />}
              cursor={{ stroke: "var(--border-strong)" }}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="value"
              name={seriesName}
              stroke={color}
              strokeWidth={2}
              fill={color}
              fillOpacity={0.12}
              dot={points.length <= 14 ? { r: 3, fill: color, strokeWidth: 0 } : false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <details className="text-sm">
        <summary className="text-secondary hover:text-foreground min-h-6 w-fit cursor-pointer rounded-sm py-0.5 font-medium">
          Show data as a table
        </summary>
        <div
          role="region"
          aria-labelledby={tableId}
          tabIndex={0}
          className="rounded-control border-border mt-3 max-h-64 overflow-auto border"
        >
          <table className="w-full text-left text-sm">
            <caption id={tableId} className="sr-only">
              {summary}
            </caption>
            <thead className="bg-surface-muted text-secondary sticky top-0">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {categoryName}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {seriesName}
                </th>
                <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {points.map((point) => (
                <tr key={point.key}>
                  <th scope="row" className="px-3 py-2 font-normal">
                    {point.fullLabel}
                  </th>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatTrendValue(point.value, unit)}
                  </td>
                  <td className="text-secondary hidden px-3 py-2 sm:table-cell">
                    {point.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
