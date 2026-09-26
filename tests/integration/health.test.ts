/**
 * GET /api/health: database + Redis status. Uses the real Redis from
 * TEST_REDIS_URL (as the rate limiter tests do) and a mocked database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Redis from "ioredis";
import crypto from "crypto";
import { GET } from "@/app/api/health/route";
import { db } from "@/server/db";
import { rateLimit } from "@/server/middleware/rateLimit";
import { checkRedisHealth, REDIS_COMMAND_TIMEOUT_MS } from "@/server/lib/redis";
import { __clearServerEnvForTesting } from "@/lib/env";

vi.mock("@/server/db", () => ({ db: { $queryRaw: vi.fn() } }));

const TEST_REDIS_URL = process.env.TEST_REDIS_URL || "redis://localhost:6379";
// Fake credentials on a closed port.
const FAKE_REDIS_PASSWORD = "fake-redis-pass-123";
const UNREACHABLE_REDIS_URL = `redis://default:${FAKE_REDIS_PASSWORD}@localhost:9999`;

let output: string[];

function resetRedisClient() {
  const g = globalThis as { redisClient?: Redis | null | undefined };
  g.redisClient?.disconnect();
  g.redisClient = undefined;
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("TEST_RL_PREFIX", `rl:test:${crypto.randomBytes(4).toString("hex")}`);
  vi.stubEnv("TEST_REDIS_URL", TEST_REDIS_URL);
  vi.stubEnv("SUPABASE_URL", "https://placeholder.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "placeholder");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "placeholder");
  vi.stubEnv("DATABASE_URL", "postgresql://placeholder");
  vi.stubEnv("DIRECT_URL", "postgresql://placeholder");
  vi.stubEnv("RAZORPAY_KEY_ID", "placeholder");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "placeholder");
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "placeholder");
  vi.stubEnv("SESSION_SECRET", "12345678901234567890123456789012");
  vi.stubEnv("CERTIFICATE_SIGNING_SECRET", "abcdefghijabcdefghijabcdefghijab");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  __clearServerEnvForTesting();
  resetRedisClient();

  vi.mocked(db.$queryRaw)
    .mockReset()
    .mockResolvedValue([{ "?column?": 1 }] as never);

  output = [];
  const capture = (...args: unknown[]) => {
    output.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" "));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capture);
  vi.spyOn(process.stderr, "write").mockImplementation(capture);
  for (const level of ["error", "warn", "log", "info", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation(capture);
  }
});

afterEach(() => {
  resetRedisClient();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});

async function health() {
  const res = await GET();
  return { status: res.status, body: await res.json() };
}

describe("GET /api/health", () => {
  it("reports ok when the database and Redis are reachable", async () => {
    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ok", db: "connected", redis: "connected" });
    expect(typeof body.latencyMs).toBe("number");
  });

  it("reports Redis unavailable as degraded, without failing the check or leaking details", async () => {
    vi.stubEnv("TEST_REDIS_URL", UNREACHABLE_REDIS_URL);
    __clearServerEnvForTesting();

    const start = Date.now();
    const { status, body } = await health();

    expect(Date.now() - start).toBeLessThan(REDIS_COMMAND_TIMEOUT_MS + 1000);
    expect(status).toBe(200);
    expect(body).toEqual({
      status: "degraded",
      db: "connected",
      redis: "unavailable",
      timestamp: expect.any(String),
      latencyMs: expect.any(Number),
    });
    const logged = output.join("\n");
    expect(logged).toContain("Health check: Redis unavailable");
    expect(logged).not.toContain(FAKE_REDIS_PASSWORD);
    expect(JSON.stringify(body)).not.toContain("9999");
  });

  it("returns 503 when the database is unreachable, still reporting Redis", async () => {
    vi.mocked(db.$queryRaw).mockRejectedValueOnce(
      new Error("Can't reach database server")
    );

    const { status, body } = await health();

    expect(status).toBe(503);
    expect(body).toMatchObject({
      status: "degraded",
      db: "disconnected",
      redis: "connected",
    });
    expect(JSON.stringify(body)).not.toContain("Can't reach");
    expect(output.join("\n")).toContain("Health check failed");
  });

  it("reports not_configured without degrading when no Redis URL is set (development)", async () => {
    vi.stubEnv("TEST_REDIS_URL", undefined);
    vi.stubEnv("REDIS_URL", undefined);
    __clearServerEnvForTesting();

    expect(await checkRedisHealth()).toEqual({ status: "not_configured" });
    const { status, body } = await health();
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ok", redis: "not_configured" });
  });
});

describe("rate limiter semantics are unchanged by health checks", () => {
  it("a health check does not consume or create rate-limit keys", async () => {
    const probe = new Redis(TEST_REDIS_URL);
    try {
      const prefix = process.env.TEST_RL_PREFIX!;
      await health();
      expect(await probe.keys(`${prefix}:*`)).toEqual([]);

      const first = await rateLimit("health_rl_id", 1, 10000);
      await health();
      const second = await rateLimit("health_rl_id", 1, 10000);
      expect(first.success).toBe(true);
      expect(second.success).toBe(false);
      await probe.del(...(await probe.keys(`${prefix}:*`)));
    } finally {
      probe.disconnect();
    }
  });

  it("with Redis down, the limiter still fails closed after a health check", async () => {
    vi.stubEnv("TEST_REDIS_URL", UNREACHABLE_REDIS_URL);
    __clearServerEnvForTesting();

    expect((await health()).body.redis).toBe("unavailable");
    expect((await rateLimit("health_down_id", 5, 10000)).success).toBe(false);
  });
});
