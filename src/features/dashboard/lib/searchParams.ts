/**
 * Search-param parsing for the history and analytics pages. Unknown values
 * fall back to the default instead of reaching the database query (where an
 * unknown enum value or an invalid date would fail the whole page).
 */

export const HISTORY_MODES = ["ALL", "TIMED", "WORDS", "CODE", "PRACTICE"] as const;
export type HistoryMode = (typeof HISTORY_MODES)[number];

export const DATE_RANGES = ["7", "30", "90", "all"] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  "7": "7 days",
  "30": "30 days",
  "90": "90 days",
  all: "All time",
};

export const ANALYTICS_MODES = ["ENGLISH", "CODE", "PRACTICE"] as const;
export type AnalyticsMode = (typeof ANALYTICS_MODES)[number];

type RawParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(
  allowed: readonly T[],
  value: string | undefined,
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export type HistoryParams = {
  mode: HistoryMode;
  range: DateRange;
  /** The "older than" cursor, only when both halves are well formed. */
  cursor: { id: string; createdAt: string } | null;
};

export function parseHistoryParams(raw: RawParams): HistoryParams {
  const cursorId = first(raw["cursorId"]);
  const cursorCreatedAt = first(raw["cursorCreatedAt"]);
  const cursorValid =
    cursorId !== undefined &&
    UUID.test(cursorId) &&
    cursorCreatedAt !== undefined &&
    !Number.isNaN(Date.parse(cursorCreatedAt));

  return {
    mode: oneOf(HISTORY_MODES, first(raw["mode"]), "ALL"),
    range: oneOf(DATE_RANGES, first(raw["range"]), "all"),
    cursor: cursorValid ? { id: cursorId, createdAt: cursorCreatedAt } : null,
  };
}

/** A history URL; the defaults are left out so the plain URL stays canonical. */
export function historyHref(params: {
  mode: HistoryMode;
  range: DateRange;
  cursor?: { id: string; createdAt: string } | null;
}): string {
  const search = new URLSearchParams();
  if (params.mode !== "ALL") search.set("mode", params.mode);
  if (params.range !== "all") search.set("range", params.range);
  if (params.cursor) {
    search.set("cursorId", params.cursor.id);
    search.set("cursorCreatedAt", params.cursor.createdAt);
  }
  const query = search.toString();
  return query ? `/dashboard/history?${query}` : "/dashboard/history";
}

export type AnalyticsParams = {
  mode: AnalyticsMode;
  range: DateRange;
  /** The viewer's IANA time zone, once the browser has reported it. */
  tz: string | null;
};

export function parseAnalyticsParams(raw: RawParams): AnalyticsParams {
  const tz = first(raw["tz"]);
  return {
    mode: oneOf(ANALYTICS_MODES, first(raw["mode"]), "ENGLISH"),
    range: oneOf(DATE_RANGES, first(raw["range"]), "30"),
    tz: tz && tz.length <= 64 ? tz : null,
  };
}

export function analyticsHref(params: AnalyticsParams): string {
  const search = new URLSearchParams();
  search.set("mode", params.mode);
  search.set("range", params.range);
  if (params.tz) search.set("tz", params.tz);
  return `/dashboard/analytics?${search.toString()}`;
}

/** "the last 7 days" / "all time", for sentences. */
export function describeRange(range: DateRange): string {
  return range === "all" ? "all time" : `the last ${range} days`;
}
