import { db } from "@/server/db";
import { requireOrganizationRole } from "./organization.service";
import { AssessmentStatus, Language, TypingMode } from "@prisma/client";
import { randomBytes, createHash } from "crypto";

export async function createAssessment(
  orgId: string,
  data: {
    title: string;
    description?: string;
    testMode: TypingMode;
    language: Language;
    codeLanguage?: string;
    duration: number;
    maxAttempts: number;
    wpmThreshold?: number;
    accuracyThreshold?: number;
  }
) {
  const ctx = await requireOrganizationRole(orgId, ["OWNER", "ADMIN", "RECRUITER"]);

  const assessment = await db.assessment.create({
    data: {
      orgId,
      title: data.title,
      description: data.description ?? null,
      testMode: data.testMode,
      language: data.language,
      codeLanguage: data.codeLanguage ?? null,
      duration: data.duration,
      maxAttempts: data.maxAttempts,
      wpmThreshold: data.wpmThreshold ?? null,
      accuracyThreshold: data.accuracyThreshold ?? null,
      status: "DRAFT",
    },
  });

  await db.auditLog.create({
    data: {
      userId: ctx.user.id,
      action: "ASSESSMENT_CREATED",
      resource: "Assessment",
      resourceId: assessment.id,
    },
  });

  return assessment;
}

export async function updateAssessmentStatus(
  orgId: string,
  assessmentId: string,
  status: AssessmentStatus
) {
  const ctx = await requireOrganizationRole(orgId, ["OWNER", "ADMIN", "RECRUITER"]);

  const assessment = await db.assessment.findUnique({ where: { id: assessmentId } });
  if (!assessment || assessment.orgId !== orgId) {
    throw new Error("ASSESSMENT_NOT_FOUND");
  }

  // Basic transition checks can be added here
  // e.g. DRAFT -> PUBLISHED, PUBLISHED -> PAUSED, PAUSED -> PUBLISHED, ANY -> CLOSED, CLOSED -> ARCHIVED

  const updated = await db.assessment.update({
    where: { id: assessmentId },
    data: { status },
  });

  await db.auditLog.create({
    data: {
      userId: ctx.user.id,
      action: `ASSESSMENT_${status}`,
      resource: "Assessment",
      resourceId: assessmentId,
    },
  });

  return updated;
}

export async function addCandidate(
  orgId: string,
  assessmentId: string,
  data: { email: string; name?: string; expiresAt?: Date }
) {
  const ctx = await requireOrganizationRole(orgId, ["OWNER", "ADMIN", "RECRUITER"]);

  const assessment = await db.assessment.findUnique({ where: { id: assessmentId } });
  if (!assessment || assessment.orgId !== orgId) {
    throw new Error("ASSESSMENT_NOT_FOUND");
  }

  const existing = await db.assessmentCandidate.findFirst({
    where: { assessmentId, email: data.email },
  });

  if (existing) {
    throw new Error("CANDIDATE_ALREADY_ADDED");
  }

  const inviteToken = randomBytes(32).toString("hex");
  const inviteTokenHash = createHash("sha256").update(inviteToken).digest("hex");

  const candidate = await db.assessmentCandidate.create({
    data: {
      assessmentId,
      email: data.email,
      name: data.name ?? null,
      expiresAt: data.expiresAt ?? null,
      inviteTokenHash,
      status: "INVITED",
    },
  });

  await db.auditLog.create({
    data: {
      userId: ctx.user.id,
      action: "CANDIDATE_ADDED",
      resource: "AssessmentCandidate",
      resourceId: candidate.id,
    },
  });

  await db.auditLog.create({
    data: {
      userId: ctx.user.id,
      action: "INVITATION_ISSUED",
      resource: "AssessmentCandidate",
      resourceId: candidate.id,
      metadata: { email: data.email },
    },
  });

  // Return plaintext token ONLY once
  return { ...candidate, inviteToken };
}

export async function getCandidateByInviteToken(inviteToken: string) {
  const inviteTokenHash = createHash("sha256").update(inviteToken).digest("hex");
  // Public access - candidate side
  const candidate = await db.assessmentCandidate.findUnique({
    where: { inviteTokenHash },
    include: { assessment: { include: { organization: true } }, attempts: true },
  });

  if (!candidate) {
    throw new Error("INVALID_INVITATION");
  }

  // Remove private reviewer notes before returning to the candidate
  const { reviewerNotes: _reviewerNotes, ...safeCandidate } = candidate;

  return safeCandidate;
}

export async function startCandidateAttempt(inviteToken: string) {
  const candidate = await getCandidateByInviteToken(inviteToken);

  if (candidate.assessment.status !== "PUBLISHED") {
    throw new Error("ASSESSMENT_NOT_ACTIVE");
  }

  const now = new Date();
  if (candidate.expiresAt && candidate.expiresAt < now) {
    throw new Error("INVITATION_EXPIRED");
  }

  if (candidate.assessment.expiresAt && candidate.assessment.expiresAt < now) {
    throw new Error("ASSESSMENT_EXPIRED");
  }

  if (candidate.attempts.length >= candidate.assessment.maxAttempts) {
    throw new Error("MAX_ATTEMPTS_REACHED");
  }

  // Create the attempt inside a transaction to strictly enforce max attempts
  return await db.$transaction(async (tx) => {
    // Acquire a row-level lock on the candidate to strictly serialize attempt creations
    await tx.$executeRaw`SELECT id FROM assessment_candidates WHERE id = ${candidate.id}::uuid FOR UPDATE`;

    const currentAttempts = await tx.assessmentAttempt.count({
      where: { candidateId: candidate.id },
    });

    if (currentAttempts >= candidate.assessment.maxAttempts) {
      throw new Error("MAX_ATTEMPTS_REACHED");
    }

    const attemptNumber = currentAttempts + 1;
    const attempt = await tx.assessmentAttempt.create({
      data: {
        candidateId: candidate.id,
        attemptNumber,
        status: "STARTED",
      },
    });

    // We can't generate the full TestSession here easily because passages are random.
    // The candidate will pass `attemptId` and `inviteToken` to the typing engine API to get a session.

    // Audit logging for attempt start (no userId since candidate is anonymous)
    await tx.auditLog.create({
      data: {
        action: "ATTEMPT_STARTED",
        resource: "AssessmentAttempt",
        resourceId: attempt.id,
      },
    });

    return attempt;
  });
}
