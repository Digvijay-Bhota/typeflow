/**
 * Rate-limit keys are scoped by environment, so a preview or local run that
 * shares a Redis instance with production never touches production's counters.
 * The test environment keeps its existing isolation unchanged.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "crypto";
import { generateRateLimitKey } from "@/server/lib/redis";

const ID = "login_ip_203.0.113.7";
const HASH = createHash("sha256").update(ID).digest("hex");

function keyIn(env: Record<string, string | undefined>): string {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return generateRateLimitKey(ID);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("E. keys differ by environment", () => {
  it.each([
    [{ VERCEL_ENV: "production", NODE_ENV: "production" }, `rl:v1:production:${HASH}`],
    [{ VERCEL_ENV: "preview", NODE_ENV: "production" }, `rl:v1:preview:${HASH}`],
    [{ VERCEL_ENV: "development", NODE_ENV: "development" }, `rl:v1:development:${HASH}`],
    [{ VERCEL_ENV: undefined, NODE_ENV: "production" }, `rl:v1:production:${HASH}`],
    [{ VERCEL_ENV: undefined, NODE_ENV: "development" }, `rl:v1:development:${HASH}`],
  ])("%o -> %s", (env, expected) => {
    expect(keyIn(env)).toBe(expected);
  });

  it("the same identifier never shares a key across environments", () => {
    const keys = new Set([
      keyIn({ VERCEL_ENV: "production", NODE_ENV: "production" }),
      keyIn({ VERCEL_ENV: "preview", NODE_ENV: "production" }),
      keyIn({ VERCEL_ENV: undefined, NODE_ENV: "development" }),
    ]);
    expect(keys.size).toBe(3);
  });
});

describe("F. the test environment is unchanged", () => {
  it("uses TEST_RL_PREFIX when set", () => {
    expect(
      keyIn({ VERCEL_ENV: undefined, NODE_ENV: "test", TEST_RL_PREFIX: "rl:test:abcd" })
    ).toBe(`rl:test:abcd:${HASH}`);
  });

  it("keeps the unscoped key without a prefix", () => {
    expect(
      keyIn({ VERCEL_ENV: undefined, NODE_ENV: "test", TEST_RL_PREFIX: undefined })
    ).toBe(`rl:v1:${HASH}`);
  });
});
