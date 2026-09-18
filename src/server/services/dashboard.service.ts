import { db } from "@/server/db";
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
  pageSize = 20
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

export async function getAnalyticsData() {
  const user = await requireAuthenticatedUser();
  const results = await db.testResult.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      wpm: true,
      accuracy: true,
      createdAt: true,
      elapsedMs: true,
    },
  });
  return results;
}
