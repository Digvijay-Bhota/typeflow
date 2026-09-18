import { NextResponse } from "next/server";
import { startCandidateAttempt } from "@/server/services/assessment.service";
import { rateLimit } from "@/server/middleware/rateLimit";

export async function POST(req: Request, { params }: { params: Promise<{ inviteToken: string }> }) {
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const { success } = await rateLimit(`attempt_create_${ip}`, 10, 60000);
  if (!success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  const p = await params;
  try {
    const attempt = await startCandidateAttempt(p.inviteToken);
    return NextResponse.json({ attempt });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
