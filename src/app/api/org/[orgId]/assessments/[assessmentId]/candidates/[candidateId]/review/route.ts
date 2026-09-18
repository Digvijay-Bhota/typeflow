import { NextResponse } from "next/server";
import { requireOrganizationRole } from "@/server/services/organization.service";
import { db } from "@/server/db";
import { z } from "zod";
import { rateLimit } from "@/server/middleware/rateLimit";

const NotesSchema = z.object({
  reviewerNotes: z.string(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ orgId: string, assessmentId: string, candidateId: string }> }) {
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const { success } = await rateLimit(`review_${ip}`, 20, 60000);
  if (!success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  const p = await params;
  try {
    const ctx = await requireOrganizationRole(p.orgId, ["OWNER", "ADMIN", "RECRUITER", "REVIEWER"]);
    
    const candidate = await db.assessmentCandidate.findUnique({
      where: { id: p.candidateId },
      include: { assessment: true },
    });

    if (!candidate || candidate.assessmentId !== p.assessmentId || candidate.assessment.orgId !== p.orgId) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const json = await req.json();
    const { reviewerNotes } = NotesSchema.parse(json);

    const updated = await db.assessmentCandidate.update({
      where: { id: p.candidateId },
      data: { reviewerNotes },
    });

    await db.auditLog.create({
      data: {
        userId: ctx.user.id,
        action: "RESULT_REVIEWED",
        resource: "AssessmentCandidate",
        resourceId: p.candidateId,
      },
    });

    return NextResponse.json({ candidate: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}
