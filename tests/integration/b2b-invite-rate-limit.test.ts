import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as GetInviteAccess } from "@/app/api/assessment-access/[inviteToken]/route";
import * as rateLimitModule from "@/server/middleware/rateLimit";

vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi.fn(),
}));
vi.mock("@/server/services/assessment.service", () => ({
  getCandidateByInviteToken: vi.fn().mockResolvedValue({ id: "123" }),
}));

describe("B2B Invitation Rate Limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed on rate limit failure (including Redis outage fallback)", async () => {
    // Simulate rateLimit returning success: false (which it does by default on Redis error)
    vi.spyOn(rateLimitModule, "rateLimit").mockResolvedValueOnce({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 60000,
    });

    const req = new Request("http://localhost/api/assessment-access/token123", {
      method: "GET",
    });

    const res = await GetInviteAccess(req, {
      params: Promise.resolve({ inviteToken: "token123" }),
    });
    expect(res.status).toBe(429);

    // Verify it was called without "FAIL_OPEN"
    expect(rateLimitModule.rateLimit).toHaveBeenCalledWith(expect.any(String), 30, 60000);
  });
});
