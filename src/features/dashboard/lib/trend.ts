/** One point of a trend chart. Plain data, so it can be passed to the client chart. */
export type TrendPoint = {
  /** Stable React key. */
  key: string;
  /** Short x-axis label ("Sep 29", "12"). */
  label: string;
  /** Full label for the tooltip and the data table ("Sep 29, 2026", "Test 12"). */
  fullLabel: string;
  value: number;
  /** Extra context for the tooltip and table ("3 tests"), if any. */
  detail: string | null;
};

export type TrendUnit = "wpm" | "percent";

/** A chart value as text: "72 WPM", "96.5%". */
export function formatTrendValue(value: number, unit: TrendUnit): string {
  if (unit === "wpm") return `${Math.round(value)} WPM`;
  return `${value.toFixed(1).replace(/\.0$/, "")}%`;
}

/**
 * Y axis for a percentage series: from a round number a little below the
 * lowest value up to 100, with evenly spaced ticks (at most six).
 */
export function percentAxis(values: number[]): {
  domain: [number, number];
  ticks: number[];
} {
  const min = values.length > 0 ? Math.min(...values) : 0;
  const floor = Math.max(0, Math.floor(min / 5) * 5 - 5);
  const span = 100 - floor;
  const step = span <= 25 ? 5 : span <= 50 ? 10 : 20;
  const low = Math.floor(floor / step) * step;
  const ticks: number[] = [];
  for (let tick = low; tick <= 100; tick += step) ticks.push(tick);
  return { domain: [low, 100], ticks };
}
