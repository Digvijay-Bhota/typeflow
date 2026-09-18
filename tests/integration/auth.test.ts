import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/result/claim/route";
import { db } from "@/server/db";
import * as authService from "@/server/services/auth.service";
import { NextRequest } from "next/server";

vi.mock("@/server/db", () => ({
  db: {
    testResult: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    testSession: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/services/auth.service", () => ({
  requireAuthenticatedUser: vi.fn(),
}));

describe("POST /api/result/claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should reject unauthenticated users", async () => {
    vi.mocked(authService.requireAuthenticatedUser).mockRejectedValue(new Error("Unauthorized"));

    const req = new NextRequest("http://localhost/api/result/claim", {
      method: "POST",
      body: JSON.stringify({ claimToken: "token123" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("should claim result if token is valid and unclaimed", async () => {
    vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({ id: "user-1" } as any);
    
    vi.mocked(db.testResult.findUnique).mockResolvedValue({
      id: "result-1",
      sessionId: "session-1",
      shareId: "share-1",
      claimToken: "token123",
      userId: null,
      session: { userId: null },
    } as any);

    const req = new NextRequest("http://localhost/api/result/claim", {
      method: "POST",
      body: JSON.stringify({ claimToken: "token123" }),
      headers: new Headers({ "x-forwarded-for": "ip2" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("should reject duplicate claim attempts", async () => {
    vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({ id: "user-1" } as any);
    
    vi.mocked(db.testResult.findUnique).mockResolvedValue({
      id: "result-1",
      sessionId: "session-1",
      shareId: "share-1",
      claimToken: "token123",
      userId: "user-2", // Already claimed
      session: { userId: "user-2" },
    } as any);

    const req = new NextRequest("http://localhost/api/result/claim", {
      method: "POST",
      body: JSON.stringify({ claimToken: "token123" }),
      headers: new Headers({ "x-forwarded-for": "ip3" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe("Result is already claimed");
  });

  it("should reject invalid/forged claim tokens", async () => {
    vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({ id: "user-1" } as any);
    
    vi.mocked(db.testResult.findUnique).mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/result/claim", {
      method: "POST",
      body: JSON.stringify({ claimToken: "forged-token" }),
      headers: new Headers({ "x-forwarded-for": "ip4" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("should reject absent claim token", async () => {
    vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({ id: "user-1" } as any);
    
    const req = new NextRequest("http://localhost/api/result/claim", {
      method: "POST",
      body: JSON.stringify({}),
      headers: new Headers({ "x-forwarded-for": "ip5" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("should nullify token upon successful claim", async () => {
    vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({ id: "user-1" } as any);
    
    vi.mocked(db.testResult.findUnique).mockResolvedValue({
      id: "result-1",
      sessionId: "session-1",
      shareId: "share-1",
      claimToken: "token123",
      userId: null,
      session: { userId: null },
    } as any);

    const req = new NextRequest("http://localhost/api/result/claim", {
      method: "POST",
      body: JSON.stringify({ claimToken: "token123" }),
      headers: new Headers({ "x-forwarded-for": "ip6" }),
    });

    await POST(req);
    
    // Verify transaction updates claimToken to null
    expect(db.testResult.update).toHaveBeenCalledWith({
      where: { id: "result-1" },
      data: { userId: "user-1", claimToken: null },
    });
  });

  it("should rate limit repeated attempts and not expose token in error", async () => {
    vi.mocked(authService.requireAuthenticatedUser).mockResolvedValue({ id: "user-1" } as any);
    vi.mocked(db.testResult.findUnique).mockResolvedValue(null);

    // Call 5 times (the limit)
    for (let i = 0; i < 5; i++) {
      const req = new NextRequest("http://localhost/api/result/claim", {
        method: "POST",
        body: JSON.stringify({ claimToken: "invalid-token" }),
        headers: new Headers({ "x-forwarded-for": "1.2.3.4" }),
      });
      await POST(req);
    }

    // 6th call should be rate limited
    const req = new NextRequest("http://localhost/api/result/claim", {
      method: "POST",
      body: JSON.stringify({ claimToken: "sensitive-token-123" }),
      headers: new Headers({ "x-forwarded-for": "1.2.3.4" }),
    });
    
    const res = await POST(req);
    expect(res.status).toBe(429);
    
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(JSON.stringify(body)).not.toContain("sensitive-token-123");
  });
});
