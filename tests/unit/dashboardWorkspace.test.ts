/**
 * The authenticated workspace (Phase 8.4): display helpers, search-param
 * parsing, the overview/analytics view models, the activity calendar, and the
 * rendered overview, first-run, history and analytics states. The views only
 * reshape service data: these tests pin that numbers pass through unchanged
 * and that empty states say what is missing instead of inventing data.
 */
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  // `scroll` is a Link option, not an <a> attribute.
  default: ({
    href,
    children,
    scroll: _scroll,
    ...rest
  }: {
    href: string;
    children: unknown;
    scroll?: boolean;
  }) => h("a", { href, ...rest }, children as never),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/dashboard/analytics",
  useSearchParams: () => new URLSearchParams(),
}));

const services = vi.hoisted(() => ({
  getDashboardStats: vi.fn(),
  getHistory: vi.fn(),
  getAnalyticsData: vi.fn(),
  getActivityHeatmap: vi.fn(),
  getAuthenticatedUser: vi.fn(),
}));
vi.mock("@/server/services/dashboard.service", () => ({
  getDashboardStats: services.getDashboardStats,
  getHistory: services.getHistory,
  getAnalyticsData: services.getAnalyticsData,
  getActivityHeatmap: services.getActivityHeatmap,
}));
vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: services.getAuthenticatedUser,
}));

import {
  formatPracticeTime,
  formatTestLength,
  formatWpmDelta,
  keyLabel,
  languageLabel,
  modeLabel,
} from "@/features/dashboard/lib/display";
import {
  analyticsHref,
  historyHref,
  parseAnalyticsParams,
  parseHistoryParams,
} from "@/features/dashboard/lib/searchParams";
import { buildOverview, type DashboardStats } from "@/features/dashboard/lib/overview";
import { formatTrendValue, percentAxis } from "@/features/dashboard/lib/trend";
import {
  analyticsPeriod,
  bucketTrends,
  summarizeBuckets,
  type AnalyticsBucket,
} from "@/features/analytics/lib/analyticsSummary";
import {
  ActivityHeatmap,
  buildActivityCalendar,
} from "@/features/analytics/components/ActivityHeatmap";
import { DashboardOverview } from "@/features/dashboard/components/DashboardOverview";
import { FirstRunOverview } from "@/features/dashboard/components/FirstRunOverview";
import {
  HistoryList,
  type HistoryRow,
} from "@/features/dashboard/components/HistoryList";
import { FilterBar } from "@/features/dashboard/components/FilterBar";
import { LocalDateTime } from "@/features/dashboard/components/LocalDateTime";
import DashboardPage from "@/app/dashboard/page";
import HistoryPage from "@/app/dashboard/history/page";
import AnalyticsPage from "@/app/dashboard/analytics/page";
import DashboardLoading from "@/app/dashboard/loading";

const html = (el: ReactElement) => renderToStaticMarkup(el);
const UUID = "0b7c1a52-3f55-4c8e-9a41-6f0d2f1d9a10";

beforeEach(() => {
  vi.clearAllMocks();
  services.getAuthenticatedUser.mockResolvedValue({ id: "u1", displayName: "Asha" });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function recentResult(i: number, wpm: number, accuracy: number) {
  return {
    id: `r${i}`,
    shareId: `share${i}`,
    wpm,
    accuracy,
    createdAt: new Date(Date.UTC(2026, 8, 29 - i, 10, 0)),
    elapsedMs: 60_000,
    errorMap: null,
    session: { mode: "TIMED" as const, language: "ENGLISH" as const, codeLanguage: null },
  };
}

/** Service output: recent tests newest first, as getDashboardStats() returns them. */
function stats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    totalTests: 12,
    avgWpm: 61.4,
    maxWpm: 83.2,
    avgAccuracy: 0.953,
    totalTimeMs: 65 * 60_000,
    totalKeystrokes: 9000,
    currentStreak: 3,
    weakKeys: [
      { key: "q", count: 7 },
      { key: " ", count: 4 },
    ],
    languageBreakdown: { ENGLISH: 3 },
    recentResults: [
      recentResult(0, 72, 0.97),
      recentResult(1, 69, 0.95),
      recentResult(2, 66, 0.9),
    ],
    ...overrides,
  } as DashboardStats;
}

const emptyStats = () =>
  stats({
    totalTests: 0,
    avgWpm: 0,
    maxWpm: 0,
    avgAccuracy: 0,
    totalTimeMs: 0,
    weakKeys: [],
    recentResults: [],
  });

function historyResult(i: number, integrityStatus = "VERIFIED") {
  return {
    id: `h${i}`,
    shareId: `hs${i}`,
    wpm: 70 + i,
    rawWpm: 74 + i,
    netWpm: 69 + i,
    accuracy: 0.96,
    duration: 60,
    integrityStatus,
    createdAt: new Date(Date.UTC(2026, 8, 20 + i, 9, 30)),
    session: { mode: "TIMED", language: "ENGLISH", codeLanguage: null, duration: 60 },
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

describe("display helpers", () => {
  it("labels modes and languages as users read them", () => {
    expect(modeLabel("CERTIFICATE")).toBe("Certified");
    expect(modeLabel("TIMED")).toBe("Timed");
    expect(modeLabel("NEWMODE")).toBe("Newmode");
    expect(languageLabel("ENGLISH")).toBe("English");
    expect(languageLabel("CODE", "cpp")).toBe("C++");
    expect(languageLabel("CODE", "TYPESCRIPT")).toBe("TypeScript"); // Prisma enum value
    expect(languageLabel("CODE", "rust")).toBe("rust");
  });

  it("formats practice time and test length", () => {
    expect(formatPracticeTime(0)).toBe("0m");
    expect(formatPracticeTime(20_000)).toBe("<1m");
    expect(formatPracticeTime(42 * 60_000)).toBe("42m");
    expect(formatPracticeTime(120 * 60_000)).toBe("2h");
    expect(formatPracticeTime(65 * 60_000)).toBe("1h 5m");
    expect(formatTestLength(null)).toBeNull();
    expect(formatTestLength(30)).toBe("30s");
    expect(formatTestLength(300)).toBe("5 min");
    expect(formatTestLength(90)).toBe("1m 30s");
  });

  it("formats WPM change with a real minus sign and no false change", () => {
    expect(formatWpmDelta(3.4)).toBe("+3 WPM");
    expect(formatWpmDelta(-2.6)).toBe("−3 WPM");
    expect(formatWpmDelta(0.3)).toBe("No change");
  });

  it("names whitespace keys for screen readers", () => {
    expect(keyLabel(" ")).toEqual({ visual: "␣", spoken: "space" });
    expect(keyLabel("q")).toEqual({ visual: "q", spoken: "q" });
  });

  it("formats trend values", () => {
    expect(formatTrendValue(71.6, "wpm")).toBe("72 WPM");
    expect(formatTrendValue(96.54, "percent")).toBe("96.5%");
    expect(formatTrendValue(97, "percent")).toBe("97%");
  });

  it("spaces percentage ticks evenly up to 100", () => {
    expect(percentAxis([91.2, 97])).toEqual({
      domain: [85, 100],
      ticks: [85, 90, 95, 100],
    });
    expect(percentAxis([62])).toEqual({
      domain: [50, 100],
      ticks: [50, 60, 70, 80, 90, 100],
    });
    expect(percentAxis([3])).toEqual({
      domain: [0, 100],
      ticks: [0, 20, 40, 60, 80, 100],
    });
    expect(percentAxis([]).domain).toEqual([0, 100]);
  });
});

// ---------------------------------------------------------------------------
// Search params
// ---------------------------------------------------------------------------

describe("search params", () => {
  it("falls back to defaults for unknown history values", () => {
    expect(parseHistoryParams({ mode: "DROP TABLE", range: "abc" })).toEqual({
      mode: "ALL",
      range: "all",
      cursor: null,
    });
    expect(parseHistoryParams({ mode: "CODE", range: "7" })).toMatchObject({
      mode: "CODE",
      range: "7",
    });
  });

  it("keeps a history cursor only when both halves are well formed", () => {
    const createdAt = "2026-09-20T09:30:00.000Z";
    expect(
      parseHistoryParams({ cursorId: UUID, cursorCreatedAt: createdAt }).cursor
    ).toEqual({
      id: UUID,
      createdAt,
    });
    expect(
      parseHistoryParams({ cursorId: "x", cursorCreatedAt: createdAt }).cursor
    ).toBeNull();
    expect(
      parseHistoryParams({ cursorId: UUID, cursorCreatedAt: "nope" }).cursor
    ).toBeNull();
    expect(parseHistoryParams({ cursorId: UUID }).cursor).toBeNull();
  });

  it("builds canonical history URLs", () => {
    expect(historyHref({ mode: "ALL", range: "all" })).toBe("/dashboard/history");
    expect(
      historyHref({ mode: "CODE", range: "30", cursor: { id: UUID, createdAt: "t" } })
    ).toBe(`/dashboard/history?mode=CODE&range=30&cursorId=${UUID}&cursorCreatedAt=t`);
  });

  it("parses analytics params and keeps the time zone in links", () => {
    expect(parseAnalyticsParams({})).toEqual({ mode: "ENGLISH", range: "30", tz: null });
    expect(parseAnalyticsParams({ mode: "HINDI", range: "365" })).toMatchObject({
      mode: "ENGLISH",
      range: "30",
    });
    const params = parseAnalyticsParams({
      mode: "CODE",
      range: "90",
      tz: "Asia/Kolkata",
    });
    expect(analyticsHref(params)).toBe(
      "/dashboard/analytics?mode=CODE&range=90&tz=Asia%2FKolkata"
    );
  });
});

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

describe("buildOverview", () => {
  it("passes service numbers through and derives only order and change", () => {
    const overview = buildOverview(stats());
    expect(overview).toMatchObject({
      totalTests: 12,
      avgWpm: 61.4,
      bestWpm: 83.2,
      avgAccuracy: 0.953,
      totalTimeMs: 65 * 60_000,
      sampleSize: 3,
    });
    expect(overview.latest?.shareId).toBe("share0");
    expect(overview.latestDelta).toBe(3); // 72 − 69
    // Trend runs oldest → newest.
    expect(overview.trend.map((p) => p.value)).toEqual([66, 69, 72]);
    expect(overview.trend[2]?.fullLabel).toBe("Test 3 of 3");
  });

  it("has no latest result, change or trend without tests", () => {
    const overview = buildOverview(emptyStats());
    expect(overview.latest).toBeNull();
    expect(overview.latestDelta).toBeNull();
    expect(overview.trend).toEqual([]);
    expect(overview.recent).toEqual([]);
  });

  it("has no change with a single test", () => {
    const overview = buildOverview(stats({ recentResults: [recentResult(0, 50, 0.9)] }));
    expect(overview.latestDelta).toBeNull();
  });
});

describe("analytics summary", () => {
  const buckets: AnalyticsBucket[] = [
    { date: "2026-09-27T00:00:00.000Z", wpm: 60, maxWpm: 70, accuracy: 0.9, count: 1 },
    { date: "2026-09-28T00:00:00.000Z", wpm: 80, maxWpm: 90, accuracy: 1, count: 3 },
  ];

  it("weights averages by the tests in each period", () => {
    expect(summarizeBuckets(buckets)).toEqual({
      tests: 4,
      avgWpm: 75,
      bestWpm: 90,
      avgAccuracy: 0.975,
    });
    expect(summarizeBuckets([])).toBeNull();
  });

  it("mirrors the service's day/week grouping", () => {
    expect(analyticsPeriod("7")).toBe("day");
    expect(analyticsPeriod("30")).toBe("day");
    expect(analyticsPeriod("90")).toBe("week");
    expect(analyticsPeriod("all")).toBe("week");
  });

  it("labels periods by their own calendar date", () => {
    const { wpm, accuracy } = bucketTrends(buckets, "day");
    expect(wpm.map((p) => p.label)).toEqual(["Sep 27", "Sep 28"]);
    expect(wpm[1]).toMatchObject({ fullLabel: "Sep 28, 2026", value: 80 });
    expect(wpm[1]?.detail).toBe("3 tests · best 90 WPM");
    expect(accuracy[0]).toMatchObject({ value: 90, detail: "1 test" });
    expect(bucketTrends(buckets, "week").wpm[0]?.fullLabel).toBe("Week of Sep 27, 2026");
  });
});

describe("activity calendar", () => {
  const today = new Date("2026-09-29T15:00:00Z"); // a Tuesday

  it("covers 365 days in Sunday-first week columns", () => {
    const { weeks } = buildActivityCalendar({}, today);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    const days = weeks.flat().filter((d) => d !== null);
    expect(days).toHaveLength(365);
    expect(days.at(-1)?.date).toBe("2026-09-29");
    expect(days[0]?.date).toBe("2025-09-30");
    // The last column ends on today's weekday: Tue is index 2, the rest is padding.
    expect(
      weeks
        .at(-1)
        ?.slice(3)
        .every((d) => d === null)
    ).toBe(true);
  });

  it("counts tests and active days, ignoring dates outside the year", () => {
    const calendar = buildActivityCalendar(
      { "2026-09-29": 3, "2026-01-02": 12, "2024-01-01": 50 },
      today
    );
    expect(calendar.totalTests).toBe(15);
    expect(calendar.activeDays).toBe(2);
    const levels = calendar.weeks
      .flat()
      .filter((d) => d && d.count > 0)
      .map((d) => d?.level);
    expect(levels).toEqual([4, 2]);
  });

  it("labels months where they start", () => {
    const { monthLabels } = buildActivityCalendar({}, today);
    const labels = monthLabels.filter(Boolean);
    expect(labels).toContain("Jan");
    expect(labels.at(-1)).toBe("Sep");
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ---------------------------------------------------------------------------
// Rendered components
// ---------------------------------------------------------------------------

describe("overview", () => {
  it("shows the real summary, latest result and next steps", () => {
    const out = html(h(DashboardOverview, { overview: buildOverview(stats()) }));
    expect(out).toContain("61 WPM"); // average
    expect(out).toContain("83 WPM"); // best
    expect(out).toContain("95.3%");
    expect(out).toContain("1h 5m of typing");
    expect(out).toContain('href="/result/share0"');
    expect(out).toContain("+3 WPM vs previous test");
    // Latest 72 WPM against the all-time average (61.4) and best (83.2).
    expect(out).toContain("+11 WPM");
    expect(out).toContain("−11 WPM");
    expect(out).toContain('href="/practice"');
    expect(out).toContain("From your last 3 tests.");
    expect(out).toContain('<span class="sr-only">space:</span>');
    expect(out).toContain('href="/dashboard/history"');
    expect(out).toContain('href="/dashboard/analytics"');
    // The certificate bar comes from constants.
    expect(out).toContain("5-minute certified test at 30+ net WPM and 90%+ accuracy");
    // Nothing the service does not provide.
    expect(out).not.toMatch(/streak|daily goal|achievement/i);
  });

  it("explains the trend instead of charting a single test", () => {
    const out = html(
      h(DashboardOverview, {
        overview: buildOverview(
          stats({ totalTests: 1, recentResults: [recentResult(0, 50, 0.9)] })
        ),
      })
    );
    expect(out).toContain("Your trend appears after your second test");
    expect(out).toContain("−33 WPM"); // 50 against the best of 83.2
    expect(out).not.toContain("vs previous test");
  });

  it("offers a plain next test when no key stands out", () => {
    const out = html(
      h(DashboardOverview, { overview: buildOverview(stats({ weakKeys: [] })) })
    );
    expect(out).toContain("Take another test");
    expect(out).not.toContain('href="/practice"');
  });

  it("gives a first-time user one clear start and no numbers", () => {
    const out = html(h(FirstRunOverview));
    expect(out).toContain("Take your first test");
    expect(out).toContain('href="/typing-test"');
    expect(out).toContain('href="/typing-test-with-certificate"');
    expect(out).not.toMatch(/\d+ WPM/);
  });
});

describe("history list", () => {
  const rows: HistoryRow[] = [
    historyResult(1),
    historyResult(2, "REVIEW"),
    historyResult(3, "INVALID"),
  ].map((r) => ({
    id: r.id,
    shareId: r.shareId,
    createdAt: r.createdAt.toISOString(),
    wpm: r.wpm,
    accuracy: r.accuracy,
    duration: r.duration,
    mode: r.session.mode,
    language: r.session.language,
    codeLanguage: r.session.codeLanguage,
    integrityStatus: r.integrityStatus,
  }));

  it("links every row to its result, visibly and with a unique name", () => {
    const out = html(h(HistoryList, { rows }));
    expect(out).toContain('href="/result/hs1"');
    expect(out).toContain("Timed · 1 min · English");
    expect(out).toContain(">View<");
    expect(out).toContain("result from");
    expect(out).not.toContain("opacity-0");
  });

  it("flags results under review or invalid", () => {
    const out = html(h(HistoryList, { rows }));
    expect(out).toContain("Under review");
    expect(out).toContain("Invalid");
  });
});

describe("shared pieces", () => {
  it("marks the current filter", () => {
    const out = html(
      h(FilterBar, {
        label: "Period",
        options: [
          { label: "7 days", href: "/a", current: true },
          { label: "All time", href: "/b", current: false },
        ],
      })
    );
    expect(out).toMatch(/role="group" aria-labelledby="[^"]+"/);
    expect(out).toMatch(/href="\/a"[^>]*aria-current="true"/);
    expect(out.match(/aria-current/g)).toHaveLength(1);
  });

  it("renders timestamps in UTC on the server, labelled", () => {
    const out = html(h(LocalDateTime, { value: "2026-09-29T15:04:00.000Z" }));
    // ICU may put a narrow no-break space before "PM".
    expect(out).toMatch(
      /^<time dateTime="2026-09-29T15:04:00.000Z">Sep 29, 2026, 3:04\s?PM UTC<\/time>$/u
    );
  });

  it("summarises the activity calendar for screen readers", () => {
    const out = html(
      h(ActivityHeatmap, {
        data: { "2026-09-28": 2 },
        today: new Date("2026-09-29T00:00:00Z"),
      })
    );
    expect(out).toContain(
      'role="img" aria-label="2 tests on 1 day in the last 12 months."'
    );
    expect(out).toContain('tabindex="0"');
    expect(out).not.toMatch(/cyan|#[0-9a-f]{6}/i);
  });

  it("announces loading once", () => {
    const out = html(h(DashboardLoading));
    expect(out).toContain('role="status"');
    expect(out).toContain("Loading…");
  });
});

// ---------------------------------------------------------------------------
// Pages: data wiring and empty states
// ---------------------------------------------------------------------------

describe("overview page", () => {
  it("welcomes a first-time user without inventing data", async () => {
    services.getDashboardStats.mockResolvedValue(emptyStats());
    const out = html(await DashboardPage());
    expect(out).toContain("Welcome to TypeFlow, Asha");
    expect(out).toContain("Take your first test");
    expect(out.match(/<h1/g)).toHaveLength(1);
  });

  it("summarises a returning user's real totals", async () => {
    services.getDashboardStats.mockResolvedValue(stats());
    services.getAuthenticatedUser.mockResolvedValue({ id: "u1", displayName: null });
    const out = html(await DashboardPage());
    expect(out).toContain("Welcome back</h1>");
    expect(out).toContain("You&#x27;ve completed 12 tests and typed for 1h 5m.");
    expect(out.match(/<h1/g)).toHaveLength(1);
  });
});

describe("history page", () => {
  it("shows the first-time empty state without filters", async () => {
    services.getHistory.mockResolvedValue({ results: [], nextCursor: null });
    const out = html(await HistoryPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("No tests yet");
    expect(out).not.toContain('role="group"');
  });

  it("keeps the filters when a filter matches nothing", async () => {
    services.getHistory.mockResolvedValue({ results: [], nextCursor: null });
    const out = html(
      await HistoryPage({ searchParams: Promise.resolve({ mode: "CODE", range: "7" }) })
    );
    expect(out).toContain("No tests match these filters");
    expect(out).toContain("no code tests from the last 7 days");
    expect(out).toContain('role="group"');
    expect(out).toContain('href="/dashboard/history"');
  });

  it("never passes unknown filters or a malformed cursor to the service", async () => {
    services.getHistory.mockResolvedValue({ results: [], nextCursor: null });
    await HistoryPage({
      searchParams: Promise.resolve({
        mode: "bogus",
        range: "x",
        cursorId: "1",
        cursorCreatedAt: "y",
      }),
    });
    expect(services.getHistory).toHaveBeenCalledWith(undefined, undefined, 20, {
      dateRange: "all",
    });
  });

  it("lists results and pages with the service cursor", async () => {
    services.getHistory.mockResolvedValue({
      results: [historyResult(1)],
      nextCursor: { id: UUID, createdAt: "2026-09-21T09:30:00.000Z" },
    });
    const out = html(
      await HistoryPage({ searchParams: Promise.resolve({ mode: "TIMED" }) })
    );
    expect(services.getHistory).toHaveBeenCalledWith(undefined, undefined, 20, {
      mode: "TIMED",
      dateRange: "all",
    });
    expect(out).toContain('href="/result/hs1"');
    expect(out).toContain(
      `/dashboard/history?mode=TIMED&amp;cursorId=${UUID}&amp;cursorCreatedAt=2026-09-21T09%3A30%3A00.000Z`
    );
  });
});

describe("analytics page", () => {
  const bucket = (day: number, count = 1): AnalyticsBucket => ({
    date: `2026-09-${day}T00:00:00.000Z`,
    wpm: 60 + day,
    maxWpm: 70 + day,
    accuracy: 0.95,
    count,
  });

  it("shows one empty state to a user with no activity", async () => {
    services.getAnalyticsData.mockResolvedValue({ data: [], insights: [] });
    services.getActivityHeatmap.mockResolvedValue({});
    const out = html(await AnalyticsPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("No activity to analyse yet");
    expect(out).not.toContain('role="group"');
  });

  it("keeps the filters for a user whose tests are in another mode", async () => {
    services.getAnalyticsData.mockResolvedValue({
      data: [],
      insights: ["Not enough data"],
    });
    services.getActivityHeatmap.mockResolvedValue({ "2026-09-28": 2 });
    const out = html(await AnalyticsPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("No standard tests in the last 30 days");
    expect(out).toContain('role="group"');
    expect(out).toContain("Show all time");
    expect(out).not.toContain("Not enough data");
  });

  it("summarises real buckets and passes sanitised params to the service", async () => {
    services.getAnalyticsData.mockResolvedValue({
      data: [bucket(26), bucket(27, 3), bucket(28)],
      insights: ["Your english speed is consistent."],
    });
    services.getActivityHeatmap.mockResolvedValue({ "2026-09-28": 1 });
    const out = html(
      await AnalyticsPage({
        searchParams: Promise.resolve({ mode: "nope", range: "7", tz: "Asia/Kolkata" }),
      })
    );
    expect(services.getAnalyticsData).toHaveBeenCalledWith(
      "ENGLISH",
      "7",
      "Asia/Kolkata"
    );
    expect(out).toContain(">5<"); // tests: 1 + 3 + 1
    expect(out).toContain("87 WPM"); // average: (86 + 87 × 3 + 88) / 5
    expect(out).toContain("98 WPM"); // best: the highest maxWpm
    expect(out).toContain("Your english speed is consistent.");
    expect(out).toContain("Show data as a table");
  });

  it("explains a single period instead of charting one point", async () => {
    services.getAnalyticsData.mockResolvedValue({ data: [bucket(28)], insights: [] });
    services.getActivityHeatmap.mockResolvedValue({ "2026-09-28": 1 });
    const out = html(await AnalyticsPage({ searchParams: Promise.resolve({}) }));
    expect(out).toContain("Trends need a little more practice");
    expect(out).not.toContain("Show data as a table");
  });
});
