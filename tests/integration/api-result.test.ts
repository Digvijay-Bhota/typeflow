import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/result/route";
import { NextRequest } from "next/server";
import { submitResult } from "@/server/services/session.service";

vi.mock("@/server/services/session.service", () => ({
  submitResult: vi.fn().mockResolvedValue({ shareUrl: "/result/share123" }),
}));
vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ success: true }),
}));

describe("POST /api/result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing integrityToken with 400", async () => {
    const payload = {
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      clientElapsedMs: 60000,
      metrics: {
        wpm: 60,
        rawWpm: 60,
        accuracy: 1,
        correctChars: 300,
        incorrectChars: 0,
        totalChars: 300,
        correctedErrors: 0,
        uncorrectedErrors: 0,
        consistency: 0.9,
      },
      errorMap: {},
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [60],
        selectionAttempts: 0,
      },
    };

    const req = new NextRequest("http://localhost/api/result", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(submitResult).not.toHaveBeenCalled();
  });

  it("accepts valid payload including integrityToken and passes it to service", async () => {
    const payload = {
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      integrityToken: "valid-token-123",
      clientElapsedMs: 60000,
      metrics: {
        wpm: 60,
        rawWpm: 60,
        accuracy: 1,
        correctChars: 300,
        incorrectChars: 0,
        totalChars: 300,
        correctedErrors: 0,
        uncorrectedErrors: 0,
        consistency: 0.9,
      },
      errorMap: {},
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [60],
        selectionAttempts: 0,
      },
    };

    const req = new NextRequest("http://localhost/api/result", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "127.0.0.1" },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(submitResult).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(submitResult).mock.calls[0]![0];
    expect(callArgs.sessionId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(callArgs.integrityToken).toBe("valid-token-123");
  });
});
