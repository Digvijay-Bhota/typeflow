import { db } from "@/server/db";
import { Prisma } from "@prisma/client";
import { requireAuthenticatedUser } from "./auth.service";

export async function getDashboardStats() {
  const user = await requireAuthenticatedUser();

  const aggregations = await db.testResult.aggregate({
    where: { userId: user.id },
    _count: { id: true },
    _avg: { wpm: true, accuracy: true },
    _max: { wpm: true },
    _sum: { elapsedMs: true, totalKeystrokes: true },
  });

  // Get last 30 tests for charts and weak keys analysis
  const recentResults = await db.testResult.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      shareId: true,
      wpm: true,
      accuracy: true,
      createdAt: true,
      elapsedMs: true,
      errorMap: true,
      session: { select: { mode: true, language: true, codeLanguage: true } },
    },
  });

  // Compute Current Streak (simple version: consecutive days with tests starting from today/yesterday)
  let currentStreak = 0;
  if (recentResults.length > 0) {
    const dates = [
      ...new Set(recentResults.map((r) => new Date(r.createdAt).toDateString())),
    ];
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    let checkDate = new Date();
    if (!dates.includes(today) && !dates.includes(yesterday)) {
      currentStreak = 0;
    } else {
      if (!dates.includes(today)) {
        checkDate = new Date(Date.now() - 86400000);
      }
      while (true) {
        if (dates.includes(checkDate.toDateString())) {
          currentStreak++;
          checkDate = new Date(checkDate.getTime() - 86400000);
        } else {
          break;
        }
      }
    }
  }

  // Find Weak Keys from errorMap
  const mistakeCounts: Record<string, number> = {};
  recentResults.forEach((r) => {
    if (r.errorMap && typeof r.errorMap === "object") {
      const map = r.errorMap as Record<string, any>;
      Object.entries(map).forEach(([key, val]) => {
        if (val && typeof val.count === "number") {
          mistakeCounts[key] = (mistakeCounts[key] || 0) + val.count;
        }
      });
    }
  });

  const weakKeys = Object.entries(mistakeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({ key, count }));

  // Breakdowns
  const languageBreakdown = recentResults.reduce(
    (acc, r) => {
      const lang = r.session.codeLanguage || r.session.language;
      acc[lang] = (acc[lang] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return {
    totalTests: aggregations._count.id,
    avgWpm: aggregations._avg.wpm || 0,
    maxWpm: aggregations._max.wpm || 0,
    avgAccuracy: aggregations._avg.accuracy || 0,
    totalTimeMs: aggregations._sum?.elapsedMs || 0,
    totalKeystrokes: aggregations._sum?.totalKeystrokes || 0,
    currentStreak,
    weakKeys,
    languageBreakdown,
    recentResults,
  };
}

export async function getHistory(
  cursorId?: string,
  cursorCreatedAt?: string,
  pageSize = 20,
  filters?: {
    mode?: string;
    language?: string;
    dateRange?: string;
  }
) {
  const user = await requireAuthenticatedUser();

  // Implement explicit cursor pagination logic
  const where: any = { userId: user.id }; // eslint-disable-line @typescript-eslint/no-explicit-any

  if (cursorId && cursorCreatedAt) {
    where.OR = [
      { createdAt: { lt: new Date(cursorCreatedAt) } },
      {
        createdAt: new Date(cursorCreatedAt),
        id: { lt: cursorId },
      },
    ];
  }

  // Apply filters
  if (filters) {
    if (filters.dateRange && filters.dateRange !== "all") {
      const days = parseInt(filters.dateRange);
      if (!isNaN(days)) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        // If we already have OR from cursor, we need to AND it with the date filter
        if (where.OR) {
          where.AND = [{ createdAt: { gte: cutoff } }];
        } else {
          where.createdAt = { gte: cutoff };
        }
      }
    }

    if (filters.mode || filters.language) {
      where.session = {};
      if (filters.mode) {
        where.session.mode = filters.mode.toUpperCase();
      }
      if (filters.language) {
        // Either standard language or codeLanguage based on mode
        if (filters.mode === "CODE") {
          where.session.codeLanguage = filters.language;
        } else {
          where.session.language = filters.language.toUpperCase();
        }
      }
    }
  }

  const results = await db.testResult.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    select: {
      id: true,
      shareId: true,
      wpm: true,
      rawWpm: true,
      netWpm: true,
      accuracy: true,
      duration: true,
      integrityStatus: true,
      createdAt: true,
      session: {
        select: { mode: true, language: true, codeLanguage: true, duration: true },
      },
    },
  });

  const hasNextPage = results.length > pageSize;
  const returnedResults = hasNextPage ? results.slice(0, -1) : results;

  const lastResult = returnedResults[returnedResults.length - 1];
  const nextCursor =
    hasNextPage && lastResult
      ? { id: lastResult.id, createdAt: lastResult.createdAt.toISOString() }
      : null;

  return { results: returnedResults, nextCursor };
}

export async function getActivityHeatmap() {
  const user = await requireAuthenticatedUser();
  const tests = await db.testResult.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
    },
    select: { createdAt: true },
  });

  const heatmap: Record<string, number> = {};
  tests.forEach((t) => {
    const dateString = t.createdAt.toISOString().split("T")[0] as string;
    heatmap[dateString] = (heatmap[dateString] || 0) + 1;
  });

  return heatmap;
}

export type AnalyticsModeGroup = "ENGLISH" | "CODE" | "PRACTICE";
export type AnalyticsDateRange = "7" | "30" | "90" | "all";

function getValidTimezone(tz: string): string {
  if (!tz) return "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export async function getAnalyticsData(
  modeGroup: AnalyticsModeGroup = "ENGLISH",
  dateRange: AnalyticsDateRange = "30",
  timezone: string = "UTC"
) {
  const safeTimezone = getValidTimezone(timezone);
  const user = await requireAuthenticatedUser();

  let startDate = new Date(0);
  if (dateRange !== "all") {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(dateRange));
  }

  // Use 'day' for 7/30 days, 'week' for 90/all
  const truncPeriod = dateRange === "7" || dateRange === "30" ? "day" : "week";

  const modeCondition = modeGroup === "CODE"
    ? Prisma.sql`AND s."mode" = 'CODE'::"TypingMode"`
    : modeGroup === "PRACTICE"
    ? Prisma.sql`AND s."mode" = 'PRACTICE'::"TypingMode"`
    : Prisma.sql`AND s."mode" NOT IN ('CODE'::"TypingMode", 'PRACTICE'::"TypingMode") AND s."language" = 'ENGLISH'::"Language"`;

  const rawResults = await db.$queryRaw<
    { date: Date; avgWpm: number; maxWpm: number; avgAccuracy: number; count: number }[]
  >`
    SELECT
      date_trunc(${Prisma.raw(`'${truncPeriod}'`)}, r."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${safeTimezone}) as "date",
      AVG(r."wpm") as "avgWpm",
      MAX(r."wpm") as "maxWpm",
      AVG(r."accuracy") as "avgAccuracy",
      COUNT(r."id")::int as "count"
    FROM "test_results" r
    JOIN "test_sessions" s ON r."sessionId" = s."id"
    WHERE r."userId" = ${user.id}::uuid
      AND r."createdAt" >= ${startDate}
      ${modeCondition}
    GROUP BY date_trunc(${Prisma.raw(`'${truncPeriod}'`)}, r."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${safeTimezone})
    ORDER BY "date" ASC
  `;

  // Generate Insights
  const insights: string[] = [];
  if (rawResults.length > 2) {
    const firstHalf = rawResults.slice(0, Math.floor(rawResults.length / 2));
    const secondHalf = rawResults.slice(Math.floor(rawResults.length / 2));

    const avgWpmFirst = firstHalf.reduce((s, r) => s + Number(r.avgWpm), 0) / firstHalf.length;
    const avgWpmSecond = secondHalf.reduce((s, r) => s + Number(r.avgWpm), 0) / secondHalf.length;

    const diff = avgWpmSecond - avgWpmFirst;
    if (diff > 2) {
      insights.push(`Your ${modeGroup.toLowerCase()} speed has improved by ${diff.toFixed(1)} WPM! Keep it up.`);
    } else if (diff < -2) {
      insights.push(`Your ${modeGroup.toLowerCase()} speed has decreased slightly. Try focusing on accuracy first.`);
    } else {
      insights.push(`Your ${modeGroup.toLowerCase()} speed is consistent. Try pushing your limits in a short 15-second test!`);
    }

    const avgAccFirst = firstHalf.reduce((s, r) => s + Number(r.avgAccuracy), 0) / firstHalf.length;
    const avgAccSecond = secondHalf.reduce((s, r) => s + Number(r.avgAccuracy), 0) / secondHalf.length;

    if (avgAccSecond < 0.95 && avgAccSecond < avgAccFirst) {
      insights.push(`Your accuracy has dropped below 95%. Slow down and focus on hitting the right keys.`);
    }
  } else {
    insights.push(`Not enough data to generate trends for the selected range. Keep practicing!`);
  }

  return {
    data: rawResults.map((r) => ({
      date: r.date.toISOString(),
      wpm: Number(r.avgWpm),
      maxWpm: Number(r.maxWpm),
      accuracy: Number(r.avgAccuracy),
      count: r.count,
    })),
    insights
  };
}
