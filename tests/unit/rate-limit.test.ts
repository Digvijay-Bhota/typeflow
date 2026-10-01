import { describe, it, expect, vi, beforeEach } from "vitest";
import { rateLimit } from "@/server/middleware/rateLimit";
import * as redisModule from "@/server/lib/redis";

vi.mock("@/server/lib/redis", () => ({
  getRedisClient: vi.fn(),
  executeRateLimitScript: vi.fn(),
}));

describe("rateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
  });

  it("fails closed by default on Redis error", async () => {
    vi.spyOn(redisModule, "getRedisClient").mockReturnValue({} as any);
    vi.spyOn(redisModule, "executeRateLimitScript").mockRejectedValue(
      new Error("Redis offline")
    );

    // Suppress console.error in test output
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await rateLimit("test_ip", 10, 60000);
    expect(result.success).toBe(false);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[RateLimit] Redis failure"),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("fails open when fallbackPolicy is FAIL_OPEN on Redis error", async () => {
    vi.spyOn(redisModule, "getRedisClient").mockReturnValue({} as any);
    vi.spyOn(redisModule, "executeRateLimitScript").mockRejectedValue(
      new Error("Redis offline")
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await rateLimit("test_ip", 10, 60000, "FAIL_OPEN");
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(1);

    consoleSpy.mockRestore();
  });
});
