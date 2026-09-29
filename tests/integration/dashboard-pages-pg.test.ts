/**
 * The workspace pages (Phase 8.4) on real Postgres: the real dashboard.service
 * queries (including the raw analytics SQL) feed the real pages, so the view
 * models are checked against the shapes Prisma actually returns. Only the
 * signed-in identity is injected (as in the other service tests); the
 * Supabase session itself is not exercised here.
 */
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { randomBytes, randomUUID } from "crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";

const auth = vi.hoisted(() => ({
  user: null as null | { id: string; displayName: string | null },
}));
vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn(async () => auth.user),
  requireAuthenticatedUser: vi.fn(async () => {
    if (!auth.user) throw new Error("Unauthorized");
    return auth.user;
  }),
}));
vi.mock("next/link", () => ({
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

import { getDashboardStats } from "@/server/services/dashboard.service";
import { buildOverview } from "@/features/dashboard/lib/overview";
import { formatWpm } from "@/features/analytics/lib/formatMetrics";
import DashboardPage from "@/app/dashboard/page";
import HistoryPage from "@/app/dashboard/history/page";
import AnalyticsPage from "@/app/dashboard/analytics/page";

const run = randomBytes(3).toString("hex");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let passageId: string;
let seq = 0;

type Users = {
  active: { id: string; displayName: string };
  fresh: { id: string; displayName: null };
  other: { id: string };
};
const users = {} as Users;
const activeShareIds: string[] = [];
let otherShareId = "";

async function createUser(label: string, displayName: string | null) {
  return db.user.create({
    data: {
      authId: randomUUID(),
      email: `dash-${run}-${label}@example.com`,
      displayName,
    },
  });
}

async function seedResult(
  userId: string,
  opts: {
    ageMs: number;
    mode?: "TIMED" | "CODE" | "CERTIFICATE" | "PRACTICE";
    wpm?: number;
    accuracy?: number;
    integrityStatus?: "VERIFIED" | "REVIEW";
    errorMap?: Record<
      string,
      { expected: string; count: number; corrected: number; uncorrected: number }
    >;
  }
): Promise<string> {
  const n = seq++;
  const mode = opts.mode ?? "TIMED";
  const duration = mode === "CERTIFICATE" ? 300 : 60;
  const createdAt = new Date(Date.now() - opts.ageMs);
  const session = await db.testSession.create({
    data: {
      userId,
      mode,
      language: mode === "CODE" ? "CODE" : "ENGLISH",
      codeLanguage: mode === "CODE" ? "TYPESCRIPT" : null,
      duration,
      status: "COMPLETED",
      passageId,
      integrityToken: `dash-${run}-${n}`,
      createdAt,
      startedAt: new Date(createdAt.getTime() - duration * 1000),
      completedAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + HOUR),
    },
  });
  const shareId = `d${run}${n}`.slice(0, 21);
  const wpm = opts.wpm ?? 60;
  await db.testResult.create({
    data: {
      sessionId: session.id,
      userId,
      shareId,
      wpm,
      rawWpm: wpm + 4,
      netWpm: wpm - 1,
      accuracy: opts.accuracy ?? 0.95,
      consistency: 0.8,
      correctChars: 300,
      incorrectChars: 10,
      totalChars: 310,
      correctedErrors: 5,
      uncorrectedErrors: 5,
      totalKeystrokes: 320,
      elapsedMs: duration * 1000,
      duration,
      integrityStatus: opts.integrityStatus ?? "VERIFIED",
      ...(opts.errorMap ? { errorMap: opts.errorMap } : {}),
      createdAt,
    },
  });
  return shareId;
}

// Seeding is ~50 inserts; give it room on a slow CI runner or a loaded machine.
beforeAll(async () => {
  const passage = await db.passage.create({
    data: { content: "dashboard pages passage", wordCount: 3, charCount: 23 },
  });
  passageId = passage.id;

  const [active, fresh, other] = await Promise.all([
    createUser("active", "Asha"),
    createUser("fresh", null),
    createUser("other", "Other"),
  ]);
  users.active = { id: active.id, displayName: "Asha" };
  users.fresh = { id: fresh.id, displayName: null };
  users.other = { id: other.id };

  // 23 results, so History has a second page (page size 20). The first is the newest.
  const timed = Array.from({ length: 18 }, (_, i) => ({
    ageMs: i * 6 * HOUR + HOUR,
    wpm: 50 + i,
    accuracy: 0.9 + (i % 10) / 100,
    errorMap: {
      q: { expected: "q", count: (i % 3) + 1, corrected: 1, uncorrected: 0 },
      " ": { expected: " ", count: 1, corrected: 0, uncorrected: 1 },
    },
  }));
  const others: Parameters<typeof seedResult>[1][] = [
    { ageMs: DAY + HOUR, mode: "CODE", wpm: 40 },
    { ageMs: DAY + 2 * HOUR, mode: "CODE", wpm: 42 },
    { ageMs: 2 * DAY, mode: "CERTIFICATE", wpm: 58 },
    { ageMs: 5 * HOUR, mode: "PRACTICE", wpm: 45 },
    { ageMs: 40 * DAY, wpm: 90, integrityStatus: "REVIEW" },
  ];
  const [shareIds, otherId] = await Promise.all([
    Promise.all([...timed, ...others].map((spec) => seedResult(active.id, spec))),
    seedResult(other.id, { ageMs: HOUR, wpm: 120 }),
  ]);
  activeShareIds.push(...shareIds);
  otherShareId = otherId;
}, 60_000);

beforeEach(() => {
  auth.user = users.active;
});

const html = async (page: Promise<ReactElement> | ReactElement) =>
  renderToStaticMarkup(await page);
const params = (p: Record<string, string> = {}) => ({ searchParams: Promise.resolve(p) });

describe("overview on real service data", () => {
  it("builds a serialisable view model from getDashboardStats()", async () => {
    const overview = buildOverview(await getDashboardStats());
    // Everything handed to client components must survive serialisation unchanged.
    expect(JSON.parse(JSON.stringify(overview))).toEqual(overview);
    expect(overview.totalTests).toBe(23);
    expect(overview.sampleSize).toBe(23);
    expect(overview.latest?.shareId).toBe(activeShareIds[0]);
    expect(overview.weakKeys.map((k) => k.key)).toEqual(["q", " "]);
    expect(overview.trend.at(-1)?.value).toBe(50); // newest last
  });

  it("renders the real totals and never another user's results", async () => {
    const agg = await db.testResult.aggregate({
      where: { userId: users.active.id },
      _avg: { wpm: true },
      _max: { wpm: true },
    });
    const out = await html(DashboardPage());
    expect(out).toContain("Welcome back, Asha");
    expect(out).toContain("completed 23 tests");
    expect(out).toContain(`${formatWpm(agg._avg.wpm ?? 0)} WPM`);
    expect(out).toContain(`${formatWpm(agg._max.wpm ?? 0)} WPM`);
    expect(out).toContain(`href="/result/${activeShareIds[0]}"`);
    expect(out).toContain('<span class="sr-only">space:</span>');
    expect(out).not.toContain(otherShareId);
  });

  it("shows the first-run overview to a user without results", async () => {
    auth.user = users.fresh;
    const out = await html(DashboardPage());
    expect(out).toContain("Welcome to TypeFlow</h1>");
    expect(out).toContain("Take your first test");
  });
});

describe("history on real service data", () => {
  it("pages through every result once, newest first", async () => {
    const first = await html(HistoryPage(params()));
    const older = first.match(/href="(\/dashboard\/history\?cursorId=[^"]+)"/)?.[1];
    expect(older).toBeDefined();
    const query = new URLSearchParams((older ?? "").replace(/&amp;/g, "&").split("?")[1]);
    const second = await html(HistoryPage(params(Object.fromEntries(query))));

    const listed = (s: string) => [
      ...new Set([...s.matchAll(/href="\/result\/([^"]+)"/g)].map((m) => m[1])),
    ];
    const all = [...listed(first), ...listed(second)];
    expect(listed(first)).toHaveLength(20);
    expect(listed(second)).toHaveLength(3);
    expect(new Set(all).size).toBe(23);
    expect(new Set(all)).toEqual(new Set(activeShareIds));
    expect(second).toContain("Back to latest");
    expect(second).toContain("That’s everything.");
  });

  it("filters by mode and flags results under review", async () => {
    const code = await html(HistoryPage(params({ mode: "CODE" })));
    expect([...code.matchAll(/href="\/result\//g)].length / 2).toBe(2); // table + card per row
    expect(code).toContain("Code · 1 min · TypeScript");

    // 18 verified timed tests plus the one under review: a single page.
    const timed = await html(HistoryPage(params({ mode: "TIMED" })));
    expect(timed).toContain("Under review");
    expect(timed).toContain("That’s everything.");
  });

  it("survives malformed parameters", async () => {
    const out = await html(
      HistoryPage(
        params({ mode: "x'--", range: "-1", cursorId: "nope", cursorCreatedAt: "bad" })
      )
    );
    expect(out).toContain(`href="/result/${activeShareIds[0]}"`);
  });
});

/*
 * Regression: getAnalyticsData() once bound the time zone twice (SELECT and
 * GROUP BY), which Postgres rejected (42803) for every call. It now groups by
 * the select-list position.
 */
describe("analytics on real service data (raw SQL)", () => {
  it("summarises the standard tests of the last 30 days in the viewer's time zone", async () => {
    const out = await html(AnalyticsPage(params({ tz: "Asia/Kolkata" })));
    // 18 timed + 1 certified in range; code, practice and the 40-day-old test are not.
    expect(out).toMatch(/Tests<\/dt><dd[^>]*>19<\/dd>/);
    expect(out).toContain("Speed");
    expect(out).toContain("Accuracy");
    expect(out).toContain("23 tests on");
    expect(out).toContain("Show data as a table"); // several days, so charts
  });

  it("summarises code tests on their own", async () => {
    const out = await html(
      AnalyticsPage(params({ mode: "CODE", range: "30", tz: "Asia/Kolkata" }))
    );
    expect(out).toMatch(/Tests<\/dt><dd[^>]*>2<\/dd>/);
    expect(out).toContain("41 WPM"); // average of 40 and 42
    expect(out).toContain("42 WPM"); // best
  });

  it("summarises a single practice day without drawing a trend", async () => {
    const out = await html(
      AnalyticsPage(params({ mode: "PRACTICE", range: "7", tz: "UTC" }))
    );
    // One practice session exists, so it is summarised rather than empty.
    expect(out).toMatch(/Tests<\/dt><dd[^>]*>1<\/dd>/);
    expect(out).toContain("Trends need a little more practice");
  });

  it("falls back to UTC for an unknown time zone", async () => {
    const out = await html(AnalyticsPage(params({ tz: "Not/AZone" })));
    expect(out).toMatch(/Tests<\/dt><dd[^>]*>19<\/dd>/);
  });

  it("shows the no-activity state to a user without results", async () => {
    auth.user = users.fresh;
    const out = await html(AnalyticsPage(params()));
    expect(out).toContain("No activity to analyse yet");
  });
});
