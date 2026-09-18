import { rateLimit } from "@/server/middleware/rateLimit";
import { NextResponse } from "next/server";
import { updateAssessmentStatus } from "@/server/services/assessment.service";

export async function POST(req: Request, { params }: { params: Promise<{ orgId: string, assessmentId: string }> }) {
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const { success } = await rateLimit(`assessment_state_${ip}`, 10, 60000);
  if (!success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  const p = await params;
  try {
    const updated = await updateAssessmentStatus(p.orgId, p.assessmentId, "PUBLISHED");
    return NextResponse.json({ assessment: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
