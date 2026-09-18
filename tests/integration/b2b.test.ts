import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createOrganization,
  requireOrganizationRole,
} from "@/server/services/organization.service";
import {
  createAssessment,
  addCandidate,
  startCandidateAttempt,
} from "@/server/services/assessment.service";
import { db } from "@/server/db";

vi.mock("@/server/db", () => ({
  db: {
    organization: { create: vi.fn(), findUnique: vi.fn() },
    organizationMember: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    assessment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    assessmentCandidate: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    assessmentAttempt: { create: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn((cb) => cb(db)),
  },
}));

vi.mock("@/server/services/auth.service", () => ({
  requireAuthenticatedUser: vi.fn().mockResolvedValue({ id: "user1" }),
  getAuthenticatedUser: vi.fn().mockResolvedValue({ id: "user1" }),
}));

describe("B2B Assessment Services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create an organization", async () => {
    (db.organization.findUnique as any).mockResolvedValue(null);
    (db.organization.create as any).mockResolvedValue({
      id: "org1",
      name: "Test Org",
      slug: "test-org",
    });

    const org = await createOrganization({ name: "Test Org", slug: "test-org" });
    expect(org.id).toBe("org1");
    expect(db.organization.create).toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it("should create an assessment", async () => {
    (db.organizationMember.findUnique as any).mockResolvedValue({
      role: "OWNER",
      organization: { id: "org1" },
    });
    (db.assessment.create as any).mockResolvedValue({ id: "a1", status: "DRAFT" });

    const assessment = await createAssessment("org1", {
      title: "Test",
      testMode: "TIMED",
      language: "ENGLISH",
      duration: 60,
      maxAttempts: 1,
    });

    expect(assessment.id).toBe("a1");
    expect(db.assessment.create).toHaveBeenCalled();
  });
});
