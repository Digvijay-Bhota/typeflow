import { rateLimit } from "@/server/middleware/rateLimit";
import { NextResponse } from "next/server";
import { addCandidate } from "@/server/services/assessment.service";
import { requireOrganizationRole } from "@/server/services/organization.service";
import { db } from "@/server/db";
import { z } from "zod";

const Schema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  expiresAt: z.coerce.date().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ orgId: string, assessmentId: string }> }) {
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const { success } = await rateLimit(`candidate_create_${ip}`, 10, 60000);
  if (!success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  const p = await params;
  try {
    const json = await req.json();
    const data = Schema.parse(json);
    const candidate = await addCandidate(p.orgId, p.assessmentId, data as any);
    return NextResponse.json({ candidate });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ orgId: string, assessmentId: string }> }) {
  const p = await params;
  try {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") || "25", 10);
    const limit = Math.min(Math.max(limitParam, 1), 100);
    const cursorId = url.searchParams.get("cursorId");
    const cursorInvitedAt = url.searchParams.get("cursorInvitedAt");

    const ctx = await requireOrganizationRole(p.orgId, ["OWNER", "ADMIN", "RECRUITER", "REVIEWER"]);
    const assessment = await db.assessment.findUnique({ where: { id: p.assessmentId } });
    if (!assessment || assessment.orgId !== p.orgId) {
      return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
    }

    const where: any = { assessmentId: p.assessmentId };
    if (cursorId && cursorInvitedAt) {
      where.OR = [
        { invitedAt: { lt: new Date(cursorInvitedAt) } },
        {
          invitedAt: new Date(cursorInvitedAt),
          id: { lt: cursorId },
        },
      ];
    }

    const candidates = await db.assessmentCandidate.findMany({
      where,
      take: limit + 1,
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        expiresAt: true,
        invitedAt: true,
        reviewerNotes: true,
        result: {
          select: {
            wpm: true,
            netWpm: true,
            accuracy: true,
            duration: true,
            integrityStatus: true,
          }
        },
        _count: {
          select: { attempts: true }
        }
      },
      orderBy: [
        { invitedAt: "desc" },
        { id: "desc" }
      ],
    });

    const hasNextPage = candidates.length > limit;
    const returnedCandidates = hasNextPage ? candidates.slice(0, -1) : candidates;

    const mappedCandidates = returnedCandidates.map(c => ({
      ...c,
      reviewerNotes: ctx.member.role === "OWNER" || ctx.member.role === "ADMIN" || ctx.member.role === "RECRUITER" || ctx.member.role === "REVIEWER" ? c.reviewerNotes : undefined,
    }));

    const lastCandidate = returnedCandidates[returnedCandidates.length - 1];
    const nextCursor = hasNextPage && lastCandidate
      ? { id: lastCandidate.id, invitedAt: lastCandidate.invitedAt.toISOString() }
      : null;

    return NextResponse.json({ candidates: mappedCandidates, nextCursor });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}
