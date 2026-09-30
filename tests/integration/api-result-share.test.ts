import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/result/[shareId]/route";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { getAuthenticatedUser } from "@/server/services/auth.service";

vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/server/db", () => ({
  db: {
    testResult: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn(),
}));

describe("GET /api/result/[shareId]", () => {
  const mockShareId = "share-123";
  const mockOwnerId = "user-owner-1";

  const getMockDbResult = () => ({
    id: "r1",
    shareId: mockShareId,
    wpm: 100,
    rawWpm: 100,
    netWpm: 100,
    accuracy: 0.98,
    consistency: 0.9,
    correctChars: 500,
    incorrectChars: 10,
    totalChars: 510,
    correctedErrors: 10,
    uncorrectedErrors: 0,
    elapsedMs: 60000,
    duration: 60,
    integrityStatus: "VERIFIED",
    scoringSource: "SERVER_RECONSTRUCTED",
    userId: mockOwnerId,
    createdAt: new Date(),
    errorMap: { a: { expected: "a", count: 2, corrected: 2, uncorrected: 0 } },
    codeMetrics: { complexity: 1 },
    session: {
      mode: "TIMED",
      language: "ENGLISH",
      trustTier: "FREE",
      passage: { content: "test" },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (db.testResult.findUnique as any).mockResolvedValue(getMockDbResult());
  });

  const makeRequest = () =>
    new NextRequest(`http://localhost/api/result/${mockShareId}`, {
      method: "GET",
      headers: { "x-forwarded-for": "127.0.0.1" },
    });

  it("1. Unauthenticated viewer: response must NOT expose errorMap or codeMetrics", async () => {
    vi.mocked(getAuthenticatedUser).mockRejectedValue(new Error("Unauthorized"));

    const res = await GET(makeRequest(), { params: Promise.resolve({ shareId: mockShareId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.shareId).toBe(mockShareId);
    expect(data.errorMap).toBeNull();
    expect(data.codeMetrics).toBeUndefined();
  });

  it("2. Authenticated non-owner: response must NOT expose errorMap or codeMetrics", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: "user-other-2" } as any);

    const res = await GET(makeRequest(), { params: Promise.resolve({ shareId: mockShareId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.shareId).toBe(mockShareId);
    expect(data.errorMap).toBeNull();
    expect(data.codeMetrics).toBeUndefined();
  });

  it("3. Authenticated owner: response DOES expose errorMap and codeMetrics", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: mockOwnerId } as any);

    const res = await GET(makeRequest(), { params: Promise.resolve({ shareId: mockShareId }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.shareId).toBe(mockShareId);
    expect(data.errorMap).toEqual({
      a: { expected: "a", count: 2, corrected: 2, uncorrected: 0 },
    });
    expect(data.codeMetrics).toEqual({ complexity: 1 });
  });
});
