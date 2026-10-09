/**
 * GET /api/cron/reconcile-subscriptions: authentication, the report-only
 * switch, query validation and HTTP methods. The reconciliation itself is
 * mocked here (see subscription-reconciliation-pg.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autoImplementMethods } from "next/dist/server/route-modules/app-route/helpers/auto-implement-methods";
import type { AppRouteHandlers } from "next/dist/server/route-modules/app-route/module";
import { HTTP_METHODS } from "next/dist/server/web/http";
import * as route from "@/app/api/cron/reconcile-subscriptions/route";
import { GET } from "@/app/api/cron/reconcile-subscriptions/route";
import { __clearServerEnvForTesting } from "@/lib/env";
import { logger } from "@/lib/logger";
import { reconcileSubscriptions } from "@/server/services/subscription.reconciliation.service";

vi.mock(
  "@/server/services/subscription.reconciliation.service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/server/services/subscription.reconciliation.service")
    >()),
    reconcileSubscriptions: vi.fn(),
  })
);

// Fake values only.
const SECRET = "test-only-cron-secret-0123456789abcdef";
const BASE_ENV: Record<string, string> = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "test-only-supabase-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-supabase-service-role-key",
  DATABASE_URL: "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  DIRECT_URL: "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  RAZORPAY_KEY_ID: "rzp_test_placeholder",
  RAZORPAY_KEY_SECRET: "test-only-razorpay-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "test-only-razorpay-webhook-secret",
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "test-only-session-secret-not-for-production",
  CERTIFICATE_SIGNING_SECRET: "test-only-certificate-signing-secret-not-for-production",
};

function setEnv(extra: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(BASE_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("CRON_SECRET", undefined);
  vi.stubEnv("SUBSCRIPTION_RECONCILE_MODE", undefined);
  vi.stubEnv("PAYMENT_RECONCILE_MODE", undefined);
  for (const [key, value] of Object.entries(extra)) vi.stubEnv(key, value);
  __clearServerEnvForTesting();
}

const SUMMARY = {
  mode: "report",
  eligible: 2,
  examined: 2,
  counts: { in_sync: 1, missed_activation: 1 },
  findings: [
    {
      subscriptionId: "00000000-0000-0000-0000-000000000001",
      providerSubscriptionId: "sub_X",
      outcomes: ["missed_activation"],
      localStatus: "TRIALING",
      providerStatus: "active",
      localPeriodEnd: null,
      providerPeriodEnd: "2026-11-01T00:00:00.000Z",
    },
  ],
  unmatchedEvents: { count: 0, providerSubscriptionIds: [] },
  truncated: false,
  durationMs: 10,
  attention: ["findings"],
};

const call = (authorization?: string, query = "") =>
  GET(
    new Request(`http://localhost/api/cron/reconcile-subscriptions${query}`, {
      headers: authorization === undefined ? {} : { authorization },
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reconcileSubscriptions).mockResolvedValue(SUMMARY as never);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});

describe("configuration", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["too short", "short-secret"],
  ])("503 when CRON_SECRET is %s, without running anything", async (_l, value) => {
    setEnv({ CRON_SECRET: value, SUBSCRIPTION_RECONCILE_MODE: "report" });
    const res = await call(`Bearer ${value ?? ""}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: "CRON_NOT_CONFIGURED", message: "Not available." },
    });
    expect(reconcileSubscriptions).not.toHaveBeenCalled();
  });
});

describe("authorization", () => {
  beforeEach(() =>
    setEnv({ CRON_SECRET: SECRET, SUBSCRIPTION_RECONCILE_MODE: "report" })
  );

  it.each([
    ["missing header", undefined],
    ["empty header", ""],
    ["wrong secret", "Bearer test-only-wrong-secret-0123456789abcdef"],
    ["secret without the Bearer scheme", SECRET],
    ["wrong scheme", `Basic ${SECRET}`],
    ["lower-case scheme", `bearer ${SECRET}`],
    ["prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
  ])("401 for %s", async (_label, header) => {
    const res = await call(header);
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toEqual({
      error: { code: "UNAUTHORIZED", message: "Unauthorized." },
    });
    expect(reconcileSubscriptions).not.toHaveBeenCalled();
  });

  it("200 with the correct secret in report mode: the summary, uncached", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(SUMMARY);
    expect(reconcileSubscriptions).toHaveBeenCalledWith({ mode: "report" });
  });

  it("a generic 500 when the run fails", async () => {
    vi.mocked(reconcileSubscriptions).mockRejectedValueOnce(
      new Error("db down: secret=xyz")
    );
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("db down");
    expect(JSON.parse(text)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Reconciliation failed." },
    });
  });
});

describe("SUBSCRIPTION_RECONCILE_MODE: disabled unless report", () => {
  it.each([undefined, "", "off", "apply", "repair", "1"])(
    "%j → 503 RECONCILE_DISABLED, nothing runs",
    async (mode) => {
      setEnv({ CRON_SECRET: SECRET, SUBSCRIPTION_RECONCILE_MODE: mode });
      vi.spyOn(logger, "warn").mockImplementation(() => {});
      const res = await call(`Bearer ${SECRET}`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: { code: "RECONCILE_DISABLED", message: "Not available." },
      });
      expect(reconcileSubscriptions).not.toHaveBeenCalled();
    }
  );

  it("is independent of PAYMENT_RECONCILE_MODE", async () => {
    setEnv({ CRON_SECRET: SECRET, PAYMENT_RECONCILE_MODE: "apply" });
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
    expect(reconcileSubscriptions).not.toHaveBeenCalled();
  });

  it("unauthorized requests get 401 even when disabled (no mode is revealed)", async () => {
    setEnv({ CRON_SECRET: SECRET, SUBSCRIPTION_RECONCILE_MODE: "off" });
    expect((await call("Bearer wrong")).status).toBe(401);
  });
});

describe("query validation", () => {
  beforeEach(() =>
    setEnv({ CRON_SECRET: SECRET, SUBSCRIPTION_RECONCILE_MODE: "report" })
  );

  it.each(["?dryRun=1", "?mode=apply", "?x", "?limit=100"])("400 for %s", async (q) => {
    const res = await call(`Bearer ${SECRET}`, q);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "INVALID_QUERY", message: "Invalid query parameters." },
    });
    expect(reconcileSubscriptions).not.toHaveBeenCalled();
  });

  it("401 comes before query validation", async () => {
    expect((await call("Bearer wrong", "?dryRun=1")).status).toBe(401);
  });
});

describe("HTTP methods", () => {
  beforeEach(() =>
    setEnv({ CRON_SECRET: SECRET, SUBSCRIPTION_RECONCILE_MODE: "report" })
  );

  it("exports GET and HEAD only", () => {
    const methods = Object.keys(route).filter((k) =>
      (HTTP_METHODS as readonly string[]).includes(k)
    );
    expect(methods.sort()).toEqual(["GET", "HEAD"]);
  });

  it("HEAD is 405, even with the correct secret, and runs nothing", async () => {
    type Handler = (req: Request) => Response | Promise<Response>;
    const served = autoImplementMethods(
      route as unknown as AppRouteHandlers
    ) as unknown as Record<(typeof HTTP_METHODS)[number], Handler>;
    expect(served.HEAD).toBe(route.HEAD);
    const res = await served.HEAD(
      new Request("http://localhost/api/cron/reconcile-subscriptions", {
        method: "HEAD",
        headers: { authorization: `Bearer ${SECRET}` },
      })
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    expect(reconcileSubscriptions).not.toHaveBeenCalled();
  });
});

describe("not scheduled", () => {
  it("vercel.json has no cron entry for this route", async () => {
    const { readFileSync } = await import("fs");
    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons?: { path: string }[];
    };
    expect(config.crons?.map((c) => c.path)).toEqual(["/api/cron/reconcile-payments"]);
  });
});
