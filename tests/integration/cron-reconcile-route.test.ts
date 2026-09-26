/**
 * GET /api/cron/reconcile-payments: authentication, configuration and the
 * shape of its responses. The reconciliation service itself is mocked here
 * (see payment-reconciliation-pg.test.ts for its behavior).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/cron/reconcile-payments/route";
import { __clearServerEnvForTesting } from "@/lib/env";
import { reconcilePayments } from "@/server/services/payment.reconciliation.service";
import { rateLimit } from "@/server/middleware/rateLimit";

vi.mock("@/server/services/payment.reconciliation.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/services/payment.reconciliation.service")
  >()),
  reconcilePayments: vi.fn(),
}));
vi.mock("@/server/middleware/rateLimit", () => ({ rateLimit: vi.fn() }));

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
  vi.stubEnv("PAYMENT_RECONCILE_MODE", undefined);
  for (const [key, value] of Object.entries(extra)) vi.stubEnv(key, value);
  __clearServerEnvForTesting();
}

const SUMMARY = {
  mode: "report",
  dryRun: false,
  examined: 3,
  counts: { in_sync: 2, captured_detected: 1 },
  truncated: false,
  durationMs: 12,
};

const call = (authorization?: string, query = "") =>
  GET(
    new Request(`http://localhost/api/cron/reconcile-payments${query}`, {
      headers: authorization === undefined ? {} : { authorization },
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reconcilePayments).mockResolvedValue(SUMMARY as never);
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});

describe("configuration", () => {
  it("503 when CRON_SECRET is unset, without running anything", async () => {
    setEnv({});
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: { code: "CRON_NOT_CONFIGURED", message: "Not available." },
    });
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["too short", "short-secret"],
  ])("503 when CRON_SECRET is %s", async (_label, value) => {
    setEnv({ CRON_SECRET: value });
    expect((await call(`Bearer ${value}`)).status).toBe(503);
    expect(reconcilePayments).not.toHaveBeenCalled();
  });
});

describe("authorization", () => {
  beforeEach(() => setEnv({ CRON_SECRET: SECRET, PAYMENT_RECONCILE_MODE: "report" }));

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
    expect(reconcilePayments).not.toHaveBeenCalled();
  });

  it("200 with the correct secret: runs in the configured mode and returns counts only", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(SUMMARY);
    expect(reconcilePayments).toHaveBeenCalledWith({ mode: "report", dryRun: false });
  });

  it("passes ?dryRun=1 through", async () => {
    await call(`Bearer ${SECRET}`, "?dryRun=1");
    expect(reconcilePayments).toHaveBeenCalledWith({ mode: "report", dryRun: true });
  });

  it("is not subject to the user rate limiter", async () => {
    for (let i = 0; i < 20; i++)
      expect((await call(`Bearer ${SECRET}`)).status).toBe(200);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("returns a generic 500 when the run fails", async () => {
    vi.mocked(reconcilePayments).mockRejectedValueOnce(
      new Error(`boom ${process.env.RAZORPAY_KEY_SECRET}`)
    );
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("boom");
    expect(text).not.toContain(BASE_ENV.RAZORPAY_KEY_SECRET!);
  });
});

describe("PAYMENT_RECONCILE_MODE", () => {
  it.each([
    [undefined, "off"],
    ["", "off"],
    ["off", "off"],
    ["report", "report"],
    ["APPLY", "apply"],
    [" apply ", "apply"],
    ["enabled", "off"],
  ] as const)("%j → %s", async (value, mode) => {
    setEnv({ CRON_SECRET: SECRET, PAYMENT_RECONCILE_MODE: value });
    await call(`Bearer ${SECRET}`);
    expect(reconcilePayments).toHaveBeenCalledWith({ mode, dryRun: false });
  });
});
