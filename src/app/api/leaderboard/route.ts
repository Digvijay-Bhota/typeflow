import { NextResponse } from "next/server";
import { getLeaderboard } from "@/server/services/leaderboard.service";
import { LeaderboardQuery } from "@/types/leaderboard";
import { rateLimit } from "@/server/middleware/rateLimit";
import { LeaderboardQuerySchema, leaderboardParams } from "@/schemas/leaderboard.schema";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const { success } = await rateLimit(`leaderboard_${ip}`, 30, 60000);

  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const parsed = LeaderboardQuerySchema.safeParse(leaderboardParams(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid query parameters",
        details: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      { status: 400 }
    );
  }

  const { period, mode, language, codeLanguage, duration, limit, offset } = parsed.data;
  const query: LeaderboardQuery = { period };
  if (mode) query.mode = mode;
  if (language) query.language = language;
  if (codeLanguage) query.codeLanguage = codeLanguage;
  if (duration !== undefined) query.duration = duration;
  if (limit !== undefined) query.limit = limit;
  if (offset !== undefined) query.offset = offset;

  try {
    const data = await getLeaderboard(query);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Leaderboard error:", error);
    return NextResponse.json({ error: "Failed to fetch leaderboard" }, { status: 500 });
  }
}
