/**
 * The shared cron authorization helper (src/server/lib/cronAuth.ts), used by
 * /api/cron/reconcile-payments and /api/cron/reconcile-subscriptions. The
 * payment route's own tests (cron-reconcile-route.test.ts) are unchanged and
 * show its behavior is the same as before the extraction.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  cronSecretConfigured,
  isCronAuthorized,
  MIN_CRON_SECRET_LENGTH,
} from "@/server/lib/cronAuth";

const SECRET = "test-only-cron-secret-0123456789abcdef";

describe("cronSecretConfigured", () => {
  it("requires at least 32 characters", () => {
    expect(MIN_CRON_SECRET_LENGTH).toBe(32);
    expect(cronSecretConfigured(undefined)).toBe(false);
    expect(cronSecretConfigured("")).toBe(false);
    expect(cronSecretConfigured("x".repeat(31))).toBe(false);
    expect(cronSecretConfigured("x".repeat(32))).toBe(true);
    expect(cronSecretConfigured(SECRET)).toBe(true);
  });
});

describe("isCronAuthorized", () => {
  it("accepts exactly `Bearer <secret>`", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["no scheme", SECRET],
    ["lower-case scheme", `bearer ${SECRET}`],
    ["Basic scheme", `Basic ${SECRET}`],
    ["prefix", `Bearer ${SECRET.slice(0, -1)}`],
    ["extra character", `Bearer ${SECRET}x`],
    ["trailing space", `Bearer ${SECRET} `],
    ["another secret", "Bearer test-only-wrong-secret-0123456789abcdef"],
  ])("rejects %s", (_label, header) => {
    expect(isCronAuthorized(header, SECRET)).toBe(false);
  });

  it("compares in constant time (hashes, then timingSafeEqual)", () => {
    const src = readFileSync(join(process.cwd(), "src/server/lib/cronAuth.ts"), "utf8");
    expect(src).toMatch(
      /timingSafeEqual\(digest\(header \?\? ""\), digest\(`Bearer \$\{secret\}`\)\)/
    );
  });
});

describe("both cron routes use it", () => {
  it.each(["reconcile-payments", "reconcile-subscriptions"])("%s", (name) => {
    const src = readFileSync(
      join(process.cwd(), `src/app/api/cron/${name}/route.ts`),
      "utf8"
    );
    expect(src).toContain('from "@/server/lib/cronAuth"');
    expect(src).toContain("cronSecretConfigured(secret)");
    expect(src).toContain('isCronAuthorized(req.headers.get("authorization"), secret)');
    expect(src).not.toMatch(/timingSafeEqual|createHash/);
  });
});
