import { NextResponse } from "next/server";
import { getCandidateByInviteToken } from "@/server/services/assessment.service";
import { rateLimit } from "@/server/middleware/rateLimit";

export async function GET(req: Request, { params }: { params: Promise<{ inviteToken: string }> }) {
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const { success } = await rateLimit(`candidate_access_${ip}`, 30, 60000);
  if (!success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  const p = await params;
  try {
    const candidate = await getCandidateByInviteToken(p.inviteToken);
    return NextResponse.json({ candidate });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
