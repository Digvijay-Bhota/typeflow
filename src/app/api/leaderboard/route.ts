import { NextResponse } from "next/server";
import { getLeaderboard } from "@/server/services/leaderboard.service";
import { LeaderboardQuery } from "@/types/leaderboard";
import { rateLimit } from "@/server/middleware/rateLimit";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const period = url.searchParams.get("period") as any || "all-time";
  const mode = url.searchParams.get("mode") || undefined;
  const language = url.searchParams.get("language") || undefined;
  const codeLanguage = url.searchParams.get("codeLanguage") || undefined;
  const durationStr = url.searchParams.get("duration");
  const limitStr = url.searchParams.get("limit");
  const offsetStr = url.searchParams.get("offset");

  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const { success } = await rateLimit(`leaderboard_${ip}`, 30, 60000);
  
  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!["daily", "weekly", "all-time"].includes(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  const query: LeaderboardQuery = { period };
  if (mode) query.mode = mode;
  if (language) query.language = language;
  if (codeLanguage) query.codeLanguage = codeLanguage;
  if (durationStr) query.duration = parseInt(durationStr, 10);
  if (limitStr) query.limit = parseInt(limitStr, 10);
  if (offsetStr) query.offset = parseInt(offsetStr, 10);

  try {
    const data = await getLeaderboard(query);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Leaderboard error:", error);
    return NextResponse.json({ error: "Failed to fetch leaderboard" }, { status: 500 });
  }
}
