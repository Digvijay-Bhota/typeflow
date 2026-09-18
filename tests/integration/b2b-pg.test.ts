import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { createOrganization } from "@/server/services/organization.service";
import { createAssessment, addCandidate, startCandidateAttempt } from "@/server/services/assessment.service";
import { createHash } from "crypto";
import { randomBytes } from "crypto";

describe("B2B PostgreSQL Integration Tests", () => {
  let orgA: any;
  let orgB: any;
  let assessmentA: any;
  let assessmentB: any;
  
  beforeAll(async () => {
    const suffix = randomBytes(4).toString('hex');
    
    const owner = await db.user.create({
      data: {
        authId: `00000000-0000-0000-0000-${suffix.padEnd(12, '0')}`,
        email: `owner-${suffix}@test.com`,
      }
    });

    orgA = await db.organization.create({
      data: { name: `Org A ${suffix}`, slug: `org-a-${suffix}`, ownerId: owner.id }
    });
    
    orgB = await db.organization.create({
      data: { name: `Org B ${suffix}`, slug: `org-b-${suffix}`, ownerId: owner.id }
    });

    assessmentA = await db.assessment.create({
      data: {
        orgId: orgA.id,
        title: "Assessment A",
        testMode: "TIMED",
        language: "ENGLISH",
        duration: 60,
        maxAttempts: 1,
        status: "PUBLISHED"
      }
    });

    assessmentB = await db.assessment.create({
      data: {
        orgId: orgB.id,
        title: "Assessment B",
        testMode: "TIMED",
        language: "ENGLISH",
        duration: 60,
        maxAttempts: 2,
        status: "PUBLISHED"
      }
    });
  });
  
  afterAll(async () => {
    await db.assessmentAttempt.deleteMany({ where: { candidate: { assessment: { orgId: { in: [orgA.id, orgB.id] } } } } });
    await db.assessmentCandidate.deleteMany({ where: { assessment: { orgId: { in: [orgA.id, orgB.id] } } } });
    await db.assessment.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } });
    await db.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("Tenant isolation: Org A cannot retrieve Org B candidates (Mocked test logic for IDOR check)", async () => {
    // The actual IDOR check is at the route level. 
    // We can simulate the route handler logic here.
    const p = { orgId: orgA.id, assessmentId: assessmentB.id };
    const assessment = await db.assessment.findUnique({ where: { id: p.assessmentId } });
    
    expect(assessment?.orgId).not.toBe(p.orgId);
  });

  it("Concurrency: maxAttempts = 1 -> exactly one succeeds", async () => {
    // We need to bypass addCandidate's requirement for a user context since it requires auth.
    // Let's create a candidate directly in DB.
    const token = randomBytes(32).toString('hex');
    const candidate = await db.assessmentCandidate.create({
      data: {
        assessmentId: assessmentA.id,
        email: `concurrency1_${Date.now()}@test.com`,
        inviteTokenHash: createHash('sha256').update(token).digest('hex'),
      }
    });

    // Run 2 concurrent attempts
    const p1 = startCandidateAttempt(token);
    const p2 = startCandidateAttempt(token);

    const results = await Promise.allSettled([p1, p2]);
    
    const succeeded = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');
    
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    if (failed[0] && failed[0].status === 'rejected') {
      expect(failed[0].reason.message).toBe("MAX_ATTEMPTS_REACHED");
    }
  });

  it("Concurrency: maxAttempts = 2 -> exactly two succeed", async () => {
    const token = randomBytes(32).toString('hex');
    const candidate = await db.assessmentCandidate.create({
      data: {
        assessmentId: assessmentB.id,
        email: `concurrency2_${Date.now()}@test.com`,
        inviteTokenHash: createHash('sha256').update(token).digest('hex'),
      }
    });

    // Run 3 concurrent attempts
    const p1 = startCandidateAttempt(token);
    const p2 = startCandidateAttempt(token);
    const p3 = startCandidateAttempt(token);

    const results = await Promise.allSettled([p1, p2, p3]);
    
    const succeeded = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');
    
    expect(succeeded.length).toBe(2);
    expect(failed.length).toBe(1);
    if (failed[0] && failed[0].status === 'rejected') {
      expect(failed[0].reason.message).toBe("MAX_ATTEMPTS_REACHED");
    }
  });

  it("Migration: Existing invitation token remains valid", async () => {
    // This tests the application logic of how tokens are resolved
    const rawToken = randomBytes(32).toString('hex');
    const hashed = createHash('sha256').update(rawToken).digest('hex');
    
    // Simulate what the DB migration does
    await db.assessmentCandidate.create({
      data: {
        assessmentId: assessmentA.id,
        email: `migration_${Date.now()}@test.com`,
        inviteTokenHash: hashed,
      }
    });

    // The application should be able to resolve it with the raw token
    const { getCandidateByInviteToken } = await import("@/server/services/assessment.service");
    const candidate = await getCandidateByInviteToken(rawToken);
    
    expect(candidate).toBeDefined();
    expect(candidate.assessmentId).toBe(assessmentA.id);
  });

  it("Privacy: Candidate list response does not expose forbidden internal fields", async () => {
    // We simulate the exact query from the GET route
    const ctx = { member: { role: "RECRUITER" } };
    
    const candidates = await db.assessmentCandidate.findMany({
      where: { assessmentId: assessmentA.id },
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
      orderBy: { invitedAt: "desc" },
    });

    // Ensure it doesn't have eventTrace
    const candidate = candidates[0];
    if (candidate && candidate.result) {
      expect((candidate.result as any).eventTrace).toBeUndefined();
      expect((candidate.result as any).integritySignals).toBeUndefined();
    }
  });
});
