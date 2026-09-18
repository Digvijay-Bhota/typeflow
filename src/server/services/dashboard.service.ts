import { db } from "@/server/db";
import { requireAuthenticatedUser } from "./auth.service";

export async function getDashboardStats() {
  const user = await requireAuthenticatedUser();

  const aggregations = await db.testResult.aggregate({
    where: { userId: user.id },
    _count: { id: true },
    _avg: { wpm: true, accuracy: true },
    _max: { wpm: true },
  });

  const recentResults = await db.testResult.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      shareId: true,
      wpm: true,
      accuracy: true,
      createdAt: true,
      session: { select: { mode: true } },
    },
  });

  return {
    totalTests: aggregations._count.id,
    avgWpm: aggregations._avg.wpm || 0,
    maxWpm: aggregations._max.wpm || 0,
    avgAccuracy: aggregations._avg.accuracy || 0,
    recentResults,
  };
}

export async function getHistory(cursorId?: string, cursorCreatedAt?: string, pageSize = 20) {
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
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
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
        select: { mode: true, language: true, duration: true },
      },
    },
  });

  const hasNextPage = results.length > pageSize;
  const returnedResults = hasNextPage ? results.slice(0, -1) : results;
  
  const lastResult = returnedResults[returnedResults.length - 1];
  const nextCursor = hasNextPage && lastResult 
    ? { id: lastResult.id, createdAt: lastResult.createdAt.toISOString() } 
    : null;

  return { results: returnedResults, nextCursor };
}
