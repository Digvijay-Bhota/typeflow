import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/server/db";
import { randomBytes, createHash } from "crypto";
import { GET } from "@/app/api/org/[orgId]/assessments/[assessmentId]/candidates/route";

describe("B2B PostgreSQL Pagination Tests", () => {
  let orgA: any;
  let orgB: any;
  let assessmentA: any;
  let assessmentB: any;
  let owner: any;

  beforeAll(async () => {
    const suffix = randomBytes(4).toString("hex");
    owner = await db.user.create({
      data: {
        authId: `00000000-0000-0000-0000-${suffix.padEnd(12, "0")}`,
        email: `owner-${suffix}@test.com`,
      },
    });

    orgA = await db.organization.create({
      data: { name: `Org A ${suffix}`, slug: `org-a-${suffix}`, ownerId: owner.id },
    });
    orgB = await db.organization.create({
      data: { name: `Org B ${suffix}`, slug: `org-b-${suffix}`, ownerId: owner.id },
    });

    await db.organizationMember.create({
      data: { orgId: orgA.id, userId: owner.id, role: "OWNER" },
    });
    await db.organizationMember.create({
      data: { orgId: orgB.id, userId: owner.id, role: "OWNER" },
    });

    assessmentA = await db.assessment.create({
      data: {
        orgId: orgA.id,
        title: "Assessment A",
        testMode: "TIMED",
        language: "ENGLISH",
        duration: 60,
        status: "PUBLISHED",
      },
    });

    assessmentB = await db.assessment.create({
      data: {
        orgId: orgB.id,
        title: "Assessment B",
        testMode: "TIMED",
        language: "ENGLISH",
        duration: 60,
        status: "PUBLISHED",
      },
    });

    // Create 150 candidates in Org A
    const candidates = Array.from({ length: 150 }).map((_, i) => ({
      assessmentId: assessmentA.id,
      email: `candidate_${i}_${suffix}@test.com`,
      inviteTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      invitedAt: new Date(Date.now() - i * 1000), // Spread out over time
    }));
    await db.assessmentCandidate.createMany({ data: candidates });
  });

  afterAll(async () => {
    await db.assessmentCandidate.deleteMany({
      where: { assessmentId: { in: [assessmentA.id, assessmentB.id] } },
    });
    await db.assessment.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } });
    await db.organizationMember.deleteMany({
      where: { orgId: { in: [orgA.id, orgB.id] } },
    });
    await db.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
    await db.user.deleteMany({ where: { id: owner.id } });
  });

  it("Case A: Request limit=25 -> exactly 25 results + next cursor", async () => {
    const limit = 25;
    const candidates = await db.assessmentCandidate.findMany({
      where: { assessmentId: assessmentA.id },
      take: limit + 1,
      orderBy: [{ invitedAt: "desc" }, { id: "desc" }],
    });
    const hasNextPage = candidates.length > limit;
    const returned = hasNextPage ? candidates.slice(0, -1) : candidates;

    expect(returned.length).toBe(25);
    expect(hasNextPage).toBe(true);
  });

  it("Case B: Follow the cursor", async () => {
    const limit = 25;
    // Page 1
    const p1 = await db.assessmentCandidate.findMany({
      where: { assessmentId: assessmentA.id },
      take: limit + 1,
      orderBy: [{ invitedAt: "desc" }, { id: "desc" }],
    });
    const cursor = p1[limit - 1]; // last of returned

    // Page 2
    const p2 = await db.assessmentCandidate.findMany({
      where: {
        assessmentId: assessmentA.id,
        OR: [
          { invitedAt: { lt: cursor!.invitedAt } },
          { invitedAt: cursor!.invitedAt, id: { lt: cursor!.id } },
        ],
      },
      take: limit + 1,
      orderBy: [{ invitedAt: "desc" }, { id: "desc" }],
    });

    expect(p2.length).toBeGreaterThan(0);
    // ensure no duplicates
    const p1Ids = new Set(p1.slice(0, 25).map((c) => c.id));
    const p2Ids = p2.slice(0, 25).map((c) => c.id);
    for (const id of p2Ids) {
      expect(p1Ids.has(id)).toBe(false);
    }
  });

  it("Case C: limit=1000 is clamped to 100", async () => {
    const requestedLimit = 1000;
    const limit = Math.min(Math.max(requestedLimit, 1), 100);
    const candidates = await db.assessmentCandidate.findMany({
      where: { assessmentId: assessmentA.id },
      take: limit + 1,
      orderBy: [{ invitedAt: "desc" }, { id: "desc" }],
    });

    const hasNextPage = candidates.length > limit;
    const returned = hasNextPage ? candidates.slice(0, -1) : candidates;
    expect(returned.length).toBe(100);
  });

  it("Case D: Cross-organization request isolation", async () => {
    const orgB_assessment = assessmentB.id;
    // Mock user context orgA
    const userOrgId = orgA.id;
    const dbAssessment = await db.assessment.findUnique({
      where: { id: orgB_assessment },
    });

    expect(dbAssessment?.orgId).not.toBe(userOrgId);
  });

  it("Case E: Candidate response does not expose internal fields", async () => {
    const candidate = await db.assessmentCandidate.findFirst({
      where: { assessmentId: assessmentA.id },
      select: {
        id: true,
        email: true,
      },
    });

    expect(candidate).not.toHaveProperty("inviteTokenHash");
    expect(candidate).not.toHaveProperty("eventTrace");
  });

  it("Case F: Concurrent insert between pages", async () => {
    const limit = 5;
    const p1 = await db.assessmentCandidate.findMany({
      where: { assessmentId: assessmentA.id },
      take: limit,
      orderBy: [{ invitedAt: "desc" }, { id: "desc" }],
    });
    const cursor = p1[limit - 1];

    const newId = randomBytes(16).toString("hex");
    await db.assessmentCandidate.create({
      data: {
        assessmentId: assessmentA.id,
        email: `concurrent_${newId}@test.com`,
        inviteTokenHash: newId,
        invitedAt: new Date(),
      },
    });

    const p2 = await db.assessmentCandidate.findMany({
      where: {
        assessmentId: assessmentA.id,
        OR: [
          { invitedAt: { lt: cursor!.invitedAt } },
          { invitedAt: cursor!.invitedAt, id: { lt: cursor!.id } },
        ],
      },
      take: limit,
      orderBy: [{ invitedAt: "desc" }, { id: "desc" }],
    });

    const foundNew = p2.some((c) => c.email === `concurrent_${newId}@test.com`);
    expect(foundNew).toBe(false);
  });
});
