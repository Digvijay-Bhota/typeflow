import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as PostAssessment } from "@/app/api/org/[orgId]/assessments/route";
import { POST as PostCandidate } from "@/app/api/org/[orgId]/assessments/[assessmentId]/candidates/route";
import { PUT as PutReview } from "@/app/api/org/[orgId]/assessments/[assessmentId]/candidates/[candidateId]/review/route";
import * as assessmentService from "@/server/services/assessment.service";
import * as organizationService from "@/server/services/organization.service";
import { ServiceError } from "@/server/errors";

vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, remaining: 10, limit: 10, reset: 0 }),
}));
vi.mock("@/server/services/organization.service", () => ({
  requireOrganizationRole: vi.fn().mockResolvedValue({ user: { id: "user1" } }),
}));
// We also need to mock db for PutReview because it uses db.assessmentCandidate.findUnique
vi.mock("@/server/db", () => ({
  db: {
    assessmentCandidate: {
      findUnique: vi.fn().mockResolvedValue({
        id: "cand1",
        assessmentId: "ass1",
        assessment: { orgId: "123" }
      }),
      update: vi.fn()
    },
    auditLog: {
      create: vi.fn()
    }
  }
}));

import { db } from "@/server/db";

describe("B2B Error Exposure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /assessments", () => {
    it("does not leak Prisma internal errors to the client", async () => {
      const prismaError = new Error("PrismaClientKnownRequestError: Unique constraint failed on the fields: (`id`)");
      prismaError.name = "PrismaClientKnownRequestError";

      vi.spyOn(assessmentService, "createAssessment").mockRejectedValueOnce(prismaError);

      const req = new Request("http://localhost/api/org/123/assessments", {
        method: "POST",
        body: JSON.stringify({
          title: "Test",
          testMode: "TIMED",
          language: "ENGLISH",
          duration: 60,
        }),
      });

      const res = await PostAssessment(req, { params: Promise.resolve({ orgId: "123" }) });
      expect(res.status).toBe(400);
      const json = await res.json();

      expect(json.error).toBe("An unexpected error occurred");
      expect(json.error).not.toContain("Unique constraint failed");
    });

    it("returns intentional ServiceError cleanly", async () => {
      const serviceError = new ServiceError("Custom domain error", "DOMAIN_ERROR", 422);
      vi.spyOn(assessmentService, "createAssessment").mockRejectedValueOnce(serviceError);

      const req = new Request("http://localhost/api/org/123/assessments", {
        method: "POST",
        body: JSON.stringify({
          title: "Test",
          testMode: "TIMED",
          language: "ENGLISH",
          duration: 60,
        }),
      });

      const res = await PostAssessment(req, { params: Promise.resolve({ orgId: "123" }) });
      expect(res.status).toBe(422);
      const json = await res.json();

      expect(json.error).toBe("Custom domain error");
    });
  });

  describe("POST /candidates", () => {
    it("does not leak Prisma internal errors to the client", async () => {
      const prismaError = new Error("Prisma internal connection error");
      vi.spyOn(assessmentService, "addCandidate").mockRejectedValueOnce(prismaError);

      const req = new Request("http://localhost/api/org/123/assessments/ass1/candidates", {
        method: "POST",
        body: JSON.stringify({
          email: "test@example.com"
        }),
      });

      const res = await PostCandidate(req, { params: Promise.resolve({ orgId: "123", assessmentId: "ass1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();

      expect(json.error).toBe("An unexpected error occurred");
    });

    it("returns intentional ServiceError cleanly", async () => {
      const serviceError = new ServiceError("Candidate already added", "CANDIDATE_EXISTS", 409);
      vi.spyOn(assessmentService, "addCandidate").mockRejectedValueOnce(serviceError);

      const req = new Request("http://localhost/api/org/123/assessments/ass1/candidates", {
        method: "POST",
        body: JSON.stringify({
          email: "test@example.com"
        }),
      });

      const res = await PostCandidate(req, { params: Promise.resolve({ orgId: "123", assessmentId: "ass1" }) });
      expect(res.status).toBe(409);
      const json = await res.json();

      expect(json.error).toBe("Candidate already added");
    });
  });

  describe("PUT /review", () => {
    it("does not leak unexpected errors to the client", async () => {
      const unexpectedError = new Error("Database deadlock");
      (db.assessmentCandidate.update as any).mockRejectedValueOnce(unexpectedError);

      const req = new Request("http://localhost/api/org/123/assessments/ass1/candidates/cand1/review", {
        method: "PUT",
        body: JSON.stringify({
          reviewerNotes: "Good job"
        }),
      });

      const res = await PutReview(req, { params: Promise.resolve({ orgId: "123", assessmentId: "ass1", candidateId: "cand1" }) });
      expect(res.status).toBe(403); // The catch block in PUT uses 403 as default fallback
      const json = await res.json();

      expect(json.error).toBe("An unexpected error occurred");
    });

    it("returns intentional ServiceError cleanly", async () => {
      const serviceError = new ServiceError("Not authorized to review", "AUTH_ERROR", 401);
      (db.assessmentCandidate.update as any).mockRejectedValueOnce(serviceError);

      const req = new Request("http://localhost/api/org/123/assessments/ass1/candidates/cand1/review", {
        method: "PUT",
        body: JSON.stringify({
          reviewerNotes: "Good job"
        }),
      });

      const res = await PutReview(req, { params: Promise.resolve({ orgId: "123", assessmentId: "ass1", candidateId: "cand1" }) });
      expect(res.status).toBe(401);
      const json = await res.json();

      expect(json.error).toBe("Not authorized to review");
    });
  });
});
