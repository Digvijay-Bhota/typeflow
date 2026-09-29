import { pluralize } from "@/features/dashboard/lib/display";
import type { TrendPoint } from "@/features/dashboard/lib/trend";

/** One period (day or week) of getAnalyticsData(). */
export type AnalyticsBucket = {
  /** Start of the period, in the viewer's time zone, encoded as a UTC ISO string. */
  date: string;
  wpm: number;
  maxWpm: number;
  /** Ratio 0–1. */
  accuracy: number;
  count: number;
};

export type AnalyticsPeriod = "day" | "week";

/** Mirrors getAnalyticsData(): daily periods for 7 and 30 days, weekly beyond. */
export function analyticsPeriod(range: string): AnalyticsPeriod {
  return range === "7" || range === "30" ? "day" : "week";
}

export type AnalyticsSummary = {
  tests: number;
  /** Test-weighted average across the periods. */
  avgWpm: number;
  bestWpm: number;
  /** Test-weighted average, ratio 0–1. */
  avgAccuracy: number;
};

/** Totals across the periods, weighted by how many tests each period holds. */
export function summarizeBuckets(buckets: AnalyticsBucket[]): AnalyticsSummary | null {
  const tests = buckets.reduce((sum, b) => sum + b.count, 0);
  if (tests === 0) return null;
  return {
    tests,
    avgWpm: buckets.reduce((sum, b) => sum + b.wpm * b.count, 0) / tests,
    bestWpm: Math.max(...buckets.map((b) => b.maxWpm)),
    avgAccuracy: buckets.reduce((sum, b) => sum + b.accuracy * b.count, 0) / tests,
  };
}

// The period start is already local to the viewer; formatting it in UTC keeps
// that calendar date instead of shifting it into the server's time zone.
const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const longDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Chart points for average WPM and average accuracy (as a percentage), oldest first. */
export function bucketTrends(
  buckets: AnalyticsBucket[],
  period: AnalyticsPeriod
): { wpm: TrendPoint[]; accuracy: TrendPoint[] } {
  const base = buckets.map((b) => {
    const date = new Date(b.date);
    const long = longDate.format(date);
    return {
      key: b.date,
      label: shortDate.format(date),
      fullLabel: period === "week" ? `Week of ${long}` : long,
      bucket: b,
    };
  });

  return {
    wpm: base.map(({ bucket, ...point }) => ({
      ...point,
      value: bucket.wpm,
      detail: `${pluralize(bucket.count, "test")} · best ${Math.round(bucket.maxWpm)} WPM`,
    })),
    accuracy: base.map(({ bucket, ...point }) => ({
      ...point,
      value: bucket.accuracy * 100,
      detail: pluralize(bucket.count, "test"),
    })),
  };
}
