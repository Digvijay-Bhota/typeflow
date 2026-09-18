import { rateLimit } from "@/server/middleware/rateLimit";
import { NextResponse } from "next/server";
import { createAssessment } from "@/server/services/assessment.service";
import { requireOrganizationRole } from "@/server/services/organization.service";
import { db } from "@/server/db";
import { z } from "zod";

const Schema = z.object({
  title: z.string().min(2),
  description: z.string().optional(),
  testMode: z.enum(["TIMED", "WORDS", "CODE"]),
  language: z.enum(["ENGLISH", "SPANISH", "FRENCH", "GERMAN"]),
  codeLanguage: z.string().optional(),
  duration: z.number().int().positive(),
  maxAttempts: z.number().int().positive().default(1),
  wpmThreshold: z.number().optional(),
  accuracyThreshold: z.number().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const { success } = await rateLimit(`assessment_create_${ip}`, 10, 60000);
  if (!success)
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  const p = await params;
  try {
    const json = await req.json();
    const parsed = Schema.parse(json);
    const data = {
      ...parsed,
      description: parsed.description ?? undefined,
      codeLanguage: parsed.codeLanguage ?? undefined,
      wpmThreshold: parsed.wpmThreshold ?? undefined,
      accuracyThreshold: parsed.accuracyThreshold ?? undefined,
    };
    const assessment = await createAssessment(p.orgId, data as any);
    return NextResponse.json({ assessment });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const p = await params;
  try {
    await requireOrganizationRole(p.orgId, ["OWNER", "ADMIN", "RECRUITER", "REVIEWER"]);
    const assessments = await db.assessment.findMany({
      where: { orgId: p.orgId },
      include: {
        _count: { select: { candidates: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ assessments });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}
