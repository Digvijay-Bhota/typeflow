import type { getDashboardStats } from "@/server/services/dashboard.service";
import { formatAccuracy } from "@/features/analytics/lib/formatMetrics";
import { modeLabel } from "./display";
import type { TrendPoint } from "./trend";

export type DashboardStats = Awaited<ReturnType<typeof getDashboardStats>>;

/** One completed test as the workspace shows it (serialisable). */
export type ResultSnapshot = {
  id: string;
  shareId: string;
  /** ISO timestamp. */
  createdAt: string;
  wpm: number;
  /** Ratio 0–1. */
  accuracy: number;
  elapsedMs: number;
  mode: string;
  language: string;
  codeLanguage: string | null;
};

export type Overview = {
  totalTests: number;
  avgWpm: number;
  bestWpm: number;
  /** Ratio 0–1. */
  avgAccuracy: number;
  totalTimeMs: number;
  latest: ResultSnapshot | null;
  /** WPM change from the test before the latest; null with fewer than two tests. */
  latestDelta: number | null;
  /** Up to five most recent tests, newest first. */
  recent: ResultSnapshot[];
  /** WPM of the recent tests, oldest first. */
  trend: TrendPoint[];
  /** Most-missed keys across the recent tests, most missed first. */
  weakKeys: { key: string; count: number }[];
  /** How many recent tests the trend and the weak keys are based on. */
  sampleSize: number;
};

type RecentResult = DashboardStats["recentResults"][number];

function toSnapshot(result: RecentResult): ResultSnapshot {
  return {
    id: result.id,
    shareId: result.shareId,
    createdAt: new Date(result.createdAt).toISOString(),
    wpm: result.wpm,
    accuracy: result.accuracy,
    elapsedMs: result.elapsedMs,
    mode: result.session.mode,
    language: result.session.language,
    codeLanguage: result.session.codeLanguage,
  };
}

/**
 * The overview's view of getDashboardStats(). Every number comes from the
 * service as is; this only reshapes it (the service returns recent tests
 * newest first).
 */
export function buildOverview(stats: DashboardStats): Overview {
  const recent = stats.recentResults.map(toSnapshot);
  const [latest, previous] = recent;
  const count = recent.length;

  const trend: TrendPoint[] = [...recent].reverse().map((result, index) => ({
    key: result.id,
    label: String(index + 1),
    fullLabel: `Test ${index + 1} of ${count}`,
    value: result.wpm,
    detail: `${formatAccuracy(result.accuracy)} accuracy · ${modeLabel(result.mode)}`,
  }));

  return {
    totalTests: stats.totalTests,
    avgWpm: stats.avgWpm,
    bestWpm: stats.maxWpm,
    avgAccuracy: stats.avgAccuracy,
    totalTimeMs: stats.totalTimeMs,
    latest: latest ?? null,
    latestDelta: latest && previous ? latest.wpm - previous.wpm : null,
    recent: recent.slice(0, 5),
    trend,
    weakKeys: stats.weakKeys,
    sampleSize: count,
  };
}
