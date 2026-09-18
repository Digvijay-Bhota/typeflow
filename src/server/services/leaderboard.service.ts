import { db } from "@/server/db";
import { Prisma } from "@prisma/client";
import { LeaderboardEntry, LeaderboardQuery } from "@/types/leaderboard";

export async function getLeaderboard(
  query: LeaderboardQuery
): Promise<{ entries: LeaderboardEntry[] }> {
  const limit = query.limit && query.limit > 0 && query.limit <= 100 ? query.limit : 50;

  let gteDate = new Date(0);
  const now = new Date();

  if (query.period === "daily") {
    gteDate = new Date(now);
    gteDate.setHours(0, 0, 0, 0);
  } else if (query.period === "weekly") {
    gteDate = new Date(now);
    const day = gteDate.getDay();
    const diff = gteDate.getDate() - day + (day === 0 ? -6 : 1);
    gteDate.setDate(diff);
    gteDate.setHours(0, 0, 0, 0);
  }

  // Raw SQL to get distinct users by best netWpm
  const results = await db.$queryRaw<any[]>`
    WITH RankedResults AS (
      SELECT 
        tr."shareId",
        tr."wpm",
        tr."netWpm",
        tr."accuracy",
        tr."duration",
        tr."integrityStatus",
        tr."createdAt",
        u."id" as "userId",
        u."displayName",
        u."avatarUrl",
        u."leaderboardOptOut",
        ts."mode",
        ts."language",
        ts."codeLanguage",
        ts."trustTier",
        ROW_NUMBER() OVER (
          PARTITION BY tr."userId" 
          ORDER BY tr."netWpm" DESC, tr."accuracy" DESC, tr."duration" ASC, tr."createdAt" ASC
        ) as rn
      FROM "test_results" tr
      JOIN "users" u ON tr."userId" = u."id"
      JOIN "test_sessions" ts ON tr."sessionId" = ts."id"
      LEFT JOIN "certificates" c ON tr."id" = c."resultId"
      WHERE tr."integrityStatus" = 'VERIFIED'
        AND u."leaderboardOptOut" = false
        AND ts."trustTier" IN ('FREE', 'CERTIFICATE')
        AND (ts."trustTier" = 'FREE' OR (ts."trustTier" = 'CERTIFICATE' AND (c."status" IS NULL OR c."status" NOT IN ('REVOKED', 'EXPIRED'))))
        AND ts."status" = 'COMPLETED'
        AND tr."createdAt" >= ${gteDate}
        ${query.mode ? Prisma.sql`AND ts."mode" = ${query.mode.toUpperCase()}::"TypingMode"` : Prisma.empty}
        ${query.language ? Prisma.sql`AND ts."language" = ${query.language.toUpperCase()}::"Language"` : Prisma.empty}
        ${query.codeLanguage ? Prisma.sql`AND ts."codeLanguage" = ${query.codeLanguage.toUpperCase()}::"CodeLanguage"` : Prisma.empty}
        ${query.duration ? Prisma.sql`AND tr."duration" = ${query.duration}` : Prisma.empty}
    )
    SELECT * FROM RankedResults
    WHERE rn = 1
    ORDER BY "netWpm" DESC, "accuracy" DESC, "duration" ASC, "createdAt" ASC
    LIMIT ${limit} OFFSET ${query.offset || 0}
  `;

  const entries: LeaderboardEntry[] = results.map((r, i) => ({
    rank: (query.offset || 0) + i + 1,
    shareId: r.shareId,
    displayName: r.displayName || "Anonymous Typist",
    avatarUrl: r.avatarUrl || null,
    wpm: r.wpm,
    netWpm: r.netWpm,
    accuracy: r.accuracy,
    duration: r.duration,
    mode: r.mode,
    language: r.language,
    codeLanguage: r.codeLanguage || undefined,
    integrityStatus: r.integrityStatus,
    isCertificateEligible:
      r.trustTier === "CERTIFICATE" && r.integrityStatus === "VERIFIED",
    trustTier: r.trustTier,
    createdAt: r.createdAt.toISOString(),
  }));

  return { entries };
}
