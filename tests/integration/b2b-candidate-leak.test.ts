import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash, randomBytes } from "crypto";
import { db } from "@/server/db";
import {
  getCandidateByInviteToken,
  startCandidateAttempt,
} from "@/server/services/assessment.service";
import { GET as getInviteAccess } from "@/app/api/assessment-access/[inviteToken]/route";

// The route's rate limiter is not under test here.
vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({
    success: true,
    limit: 30,
    remaining: 29,
    reset: Date.now() + 60000,
  }),
}));

/**
 * The public invite lookup is reachable by anyone holding an invite link, so
 * it must return only what a candidate needs to take the assessment. Runs
 * against real Postgres: it checks the object the service actually returns.
 */
describe("B2B Candidate Leakage", () => {
  const suffix = randomBytes(4).toString("hex");
  const rawToken = randomBytes(32).toString("hex");
  const inviteTokenHash = createHash("sha256").update(rawToken).digest("hex");

  // Values that must never reach a candidate, chosen so they cannot appear in
  // the response by coincidence.
  const WPM_THRESHOLD = 7919;
  const ACCURACY_THRESHOLD = 0.987654321;
  const ORG_PLAN = `PLAN_${suffix.toUpperCase()}`;
  const ORG_DOMAIN = `private-${suffix}.example.com`;
  const REVIEWER_NOTES = `reviewer-notes-${suffix}`;

  let ownerId: string;
  let orgId: string;
  let assessmentId: string;
  let candidateId: string;

  beforeAll(async () => {
    const owner = await db.user.create({
      data: {
        authId: `00000000-0000-0000-0001-${suffix.padEnd(12, "0")}`,
        email: `leak-owner-${suffix}@test.com`,
      },
    });
    ownerId = owner.id;

    const org = await db.organization.create({
      data: {
        name: `Leak Org ${suffix}`,
        slug: `leak-org-${suffix}`,
        domain: ORG_DOMAIN,
        plan: ORG_PLAN,
        ownerId,
      },
    });
    orgId = org.id;

    const assessment = await db.assessment.create({
      data: {
        orgId,
        title: "Leak Assessment",
        description: "Shown to the candidate",
        testMode: "TIMED",
        language: "ENGLISH",
        duration: 60,
        maxAttempts: 2,
        wpmThreshold: WPM_THRESHOLD,
        accuracyThreshold: ACCURACY_THRESHOLD,
        status: "PUBLISHED",
      },
    });
    assessmentId = assessment.id;

    const candidate = await db.assessmentCandidate.create({
      data: {
        assessmentId,
        email: `leak-candidate-${suffix}@test.com`,
        name: "Leak Candidate",
        inviteTokenHash,
        reviewerNotes: REVIEWER_NOTES,
      },
    });
    candidateId = candidate.id;
  });

  afterAll(async () => {
    const attempts = await db.assessmentAttempt.findMany({
      where: { candidateId },
      select: { id: true },
    });
    await db.auditLog.deleteMany({
      where: {
        resource: "AssessmentAttempt",
        resourceId: { in: attempts.map((attempt) => attempt.id) },
      },
    });
    await db.assessmentAttempt.deleteMany({ where: { candidateId } });
    await db.assessmentCandidate.deleteMany({ where: { id: candidateId } });
    await db.assessment.deleteMany({ where: { id: assessmentId } });
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: ownerId } });
  });

  /** Fails if any private value or field name appears anywhere in `value`. */
  function expectNoPrivateData(value: unknown) {
    const json = JSON.stringify(value);
    // Numbers are matched as whole JSON values, so an id or timestamp that
    // happens to contain the digits cannot fail the test.
    expect(json).not.toMatch(new RegExp(`:${WPM_THRESHOLD}[,}]`));
    for (const privateValue of [
      String(ACCURACY_THRESHOLD),
      ORG_PLAN,
      ORG_DOMAIN,
      REVIEWER_NOTES,
      inviteTokenHash,
      ownerId,
      orgId,
    ]) {
      expect(json).not.toContain(privateValue);
    }
    for (const privateKey of [
      "wpmThreshold",
      "accuracyThreshold",
      "ownerId",
      "plan",
      "domain",
      "slug",
      "orgId",
      "reviewerNotes",
      "inviteTokenHash",
    ]) {
      expect(json).not.toContain(`"${privateKey}"`);
    }
  }

  it("does not leak assessment thresholds or organization owner metadata", async () => {
    const candidate = await getCandidateByInviteToken(rawToken);

    const assessment = candidate.assessment as Record<string, unknown>;
    const organization = candidate.assessment.organization as Record<string, unknown>;
    expect(assessment).not.toHaveProperty("wpmThreshold");
    expect(assessment).not.toHaveProperty("accuracyThreshold");
    expect(organization).not.toHaveProperty("ownerId");
    expect(organization).not.toHaveProperty("plan");

    expectNoPrivateData(candidate);
  });

  it("returns exactly the candidate-safe shape", async () => {
    const candidate = await getCandidateByInviteToken(rawToken);

    expect(Object.keys(candidate).sort()).toEqual([
      "assessment",
      "assessmentId",
      "attempts",
      "email",
      "expiresAt",
      "id",
      "name",
      "status",
    ]);
    expect(Object.keys(candidate.assessment).sort()).toEqual([
      "codeLanguage",
      "description",
      "duration",
      "expiresAt",
      "language",
      "maxAttempts",
      "organization",
      "status",
      "testMode",
      "title",
    ]);
    expect(candidate.assessment.organization).toEqual({ name: `Leak Org ${suffix}` });

    // What the candidate does need is still there.
    expect(candidate.id).toBe(candidateId);
    expect(candidate.assessmentId).toBe(assessmentId);
    expect(candidate.status).toBe("INVITED");
    expect(candidate.assessment.title).toBe("Leak Assessment");
    expect(candidate.assessment.duration).toBe(60);
    expect(candidate.assessment.maxAttempts).toBe(2);
    expect(candidate.attempts).toEqual([]);
  });

  it("the public invite route response carries no private data either", async () => {
    const res = await getInviteAccess(
      new Request(`http://localhost/api/assessment-access/${rawToken}`),
      { params: Promise.resolve({ inviteToken: rawToken }) }
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.candidate.id).toBe(candidateId);
    expect(body.candidate.assessment.organization).toEqual({
      name: `Leak Org ${suffix}`,
    });
    expectNoPrivateData(body);
  });

  it("still lets the candidate start an attempt, and lists it without internal ids", async () => {
    const attempt = await startCandidateAttempt(rawToken);
    expect(attempt.attemptNumber).toBe(1);

    const candidate = await getCandidateByInviteToken(rawToken);
    expect(candidate.attempts).toHaveLength(1);
    expect(Object.keys(candidate.attempts[0]!).sort()).toEqual([
      "attemptNumber",
      "completedAt",
      "id",
      "startedAt",
      "status",
    ]);
    expect(candidate.attempts[0]!.id).toBe(attempt.id);
    expectNoPrivateData(candidate);
  });
});
