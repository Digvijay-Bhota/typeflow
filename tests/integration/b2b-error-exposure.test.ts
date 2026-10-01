import { describe, it, expect, vi } from "vitest";
import { POST } from "@/app/api/org/[orgId]/assessments/route";
import * as assessmentService from "@/server/services/assessment.service";

vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, remaining: 10, limit: 10, reset: 0 }),
}));
vi.mock("@/server/services/organization.service", () => ({
  requireOrganizationRole: vi.fn().mockResolvedValue({}),
}));

describe("B2B Error Exposure", () => {
  it("does not leak Prisma internal errors to the client", async () => {
    // Mock the service to throw a Prisma-like error
    const prismaError = new Error(
      "PrismaClientKnownRequestError: Unique constraint failed on the fields: (`id`)"
    );
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

    const res = await POST(req, { params: Promise.resolve({ orgId: "123" }) });
    expect(res.status).toBe(400);
    const json = await res.json();

    expect(json.error).toBe("Database operation failed");
    expect(json.error).not.toContain("Unique constraint failed");
  });
});
