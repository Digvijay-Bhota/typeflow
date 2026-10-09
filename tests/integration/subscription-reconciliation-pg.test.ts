/**
 * Subscription reconciliation (report only) against real Postgres, with the
 * Razorpay lookup faked (fetchRazorpaySubscription; see
 * razorpaySubscriptionFetch.test.ts for the real HTTP and timeout behavior).
 *
 * Isolation: this file's rows are dated in 2001 and each run uses a 2001
 * "now". The run only reads rows last changed 15 minutes before its now, so
 * rows other test files create at the real date are never seen.
 */
import { randomBytes, randomUUID } from "crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SubscriptionStatus } from "@prisma/client";
import { db } from "@/server/db";
import { __clearServerEnvForTesting } from "@/lib/env";
import { logger } from "@/lib/logger";

// Any Razorpay SDK use would be a provider-side action: fail loudly.
const sdkConstructed = vi.hoisted(() => vi.fn());
vi.mock("razorpay", () => ({
  default: vi.fn().mockImplementation(() => {
    sdkConstructed();
    throw new Error("the Razorpay SDK must not be used by the reconciler");
  }),
}));

const fetchSub = vi.hoisted(() => vi.fn());
const mutating = vi.hoisted(() => ({
  createRazorpaySubscription: vi.fn(),
  cancelRazorpaySubscription: vi.fn(),
}));
vi.mock("@/server/services/razorpay.subscription.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/services/razorpay.subscription.service")
  >()),
  fetchRazorpaySubscription: fetchSub,
  ...mutating,
}));

import { RazorpayLookupError } from "@/server/services/razorpay.subscription.service";
import type { RazorpaySubscriptionSnapshot } from "@/server/services/razorpay.subscription.service";
import {
  reconcileSubscriptions,
  subscriptionReconcileModeFromEnv,
  type SubscriptionReconcileSummary,
} from "@/server/services/subscription.reconciliation.service";

const NOW = new Date("2001-06-01T00:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OLD = new Date(NOW.getTime() - 30 * DAY);
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

const created = { users: [] as string[], subs: [] as string[], events: [] as string[] };
const providers = new Map<string, RazorpaySubscriptionSnapshot | Error>();

beforeAll(() => __clearServerEnvForTesting());
afterAll(() => {
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});

beforeEach(() => {
  providers.clear();
  fetchSub.mockReset();
  fetchSub.mockImplementation(async (id: string) => {
    const p = providers.get(id);
    if (p === undefined) throw new RazorpayLookupError("not_found", 400);
    if (p instanceof Error) throw p;
    return p;
  });
});

afterEach(async () => {
  await db.subscriptionEvent.deleteMany({ where: { id: { in: created.events } } });
  await db.subscription.deleteMany({ where: { id: { in: created.subs } } });
  await db.user.deleteMany({ where: { id: { in: created.users } } });
  created.users = [];
  created.subs = [];
  created.events = [];
  vi.restoreAllMocks();
});

type SubSpec = {
  status: SubscriptionStatus;
  plan?: "PRO" | "FREE";
  providerSubscriptionId?: string;
  providerPlanId?: string | null;
  currentPeriodEnd?: Date | null;
  cancelledAt?: Date | null;
  updatedAt?: Date;
};

/** A user and their subscription, last changed at `updatedAt` (default: OLD). */
async function makeSub(spec: SubSpec) {
  const tag = randomBytes(5).toString("hex");
  const user = await db.user.create({
    data: {
      authId: randomUUID(),
      email: `recon-${tag}@example.com`,
      displayName: `Recon Person ${tag}`,
    },
  });
  created.users.push(user.id);
  const providerSubscriptionId = spec.providerSubscriptionId ?? `sub_recon${tag}`;
  const sub = await db.subscription.create({
    data: {
      userId: user.id,
      plan: spec.plan ?? "PRO",
      status: spec.status,
      providerSubscriptionId,
      providerPlanId:
        spec.providerPlanId === undefined ? "plan_recon" : spec.providerPlanId,
      currentPeriodStart: spec.currentPeriodEnd
        ? new Date(spec.currentPeriodEnd.getTime() - 30 * DAY)
        : null,
      currentPeriodEnd: spec.currentPeriodEnd ?? null,
      cancelAt: spec.currentPeriodEnd ?? null,
      cancelledAt: spec.cancelledAt ?? null,
    },
  });
  created.subs.push(sub.id);
  await db.$executeRaw`UPDATE subscriptions SET "updatedAt" = ${spec.updatedAt ?? OLD} WHERE id = ${sub.id}::uuid`;
  return { id: sub.id, userId: user.id, providerSubscriptionId, email: user.email, tag };
}

/** Razorpay's view of a subscription, matching the local one by default. */
function provider(
  s: { providerSubscriptionId: string; userId: string },
  over: Partial<RazorpaySubscriptionSnapshot> = {}
) {
  providers.set(s.providerSubscriptionId, {
    id: s.providerSubscriptionId,
    status: "active",
    planId: "plan_recon",
    currentStart: unix(new Date(NOW.getTime() - 20 * DAY)),
    currentEnd: unix(new Date(NOW.getTime() + 10 * DAY)),
    endedAt: null,
    paidCount: 1,
    notesUserId: s.userId,
    ...over,
  });
}

const run = (over: Partial<Parameters<typeof reconcileSubscriptions>[0]> = {}) =>
  reconcileSubscriptions({ mode: "report", now: NOW, ...over });

const finding = (s: SubscriptionReconcileSummary, id: string) =>
  s.findings.find((f) => f.subscriptionId === id);

const ACTIVE_END = new Date(NOW.getTime() + 10 * DAY);

describe("classification", { timeout: 30_000 }, () => {
  it("1. matching subscriptions are in sync and need no attention", async () => {
    const a = await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END });
    const t = await makeSub({ status: "TRIALING" });
    provider(a);
    provider(t, { status: "created", paidCount: 0, currentEnd: null });

    const s = await run();
    expect(s.eligible).toBe(2);
    expect(s.examined).toBe(2);
    expect(s.counts).toEqual({ in_sync: 2 });
    expect(s.findings).toEqual([]);
    expect(s.attention).toEqual([]);
  });

  it("2. missed activation: local TRIALING, Razorpay active and paid", async () => {
    const t = await makeSub({ status: "TRIALING" });
    provider(t, { status: "active", paidCount: 1 });
    const s = await run();
    expect(finding(s, t.id)).toMatchObject({
      providerSubscriptionId: t.providerSubscriptionId,
      outcomes: ["missed_activation"],
      localStatus: "TRIALING",
      providerStatus: "active",
    });
    expect(s.attention).toEqual(["findings"]);
  });

  it("3. missed cancellation: local ACTIVE, Razorpay cancelled", async () => {
    const a = await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END });
    provider(a, { status: "cancelled", endedAt: unix(OLD) });
    const s = await run();
    expect(finding(s, a.id)?.outcomes).toEqual(["missed_cancellation"]);
    expect(s.counts.missed_cancellation).toBe(1);
  });

  it("4. cancellation pending: cancelled at period end, still active on Razorpay → expected", async () => {
    const c = await makeSub({
      status: "CANCELLED",
      currentPeriodEnd: new Date(NOW.getTime() + 5 * DAY),
      cancelledAt: OLD,
    });
    provider(c, { status: "active" });
    const s = await run();
    expect(s.counts).toEqual({ cancellation_pending: 1 });
    expect(s.findings).toEqual([]);
    expect(s.attention).toEqual([]);
  });

  it("5. cancellation not honoured: still active 24 h after the local period end", async () => {
    const within = await makeSub({
      status: "CANCELLED",
      currentPeriodEnd: new Date(NOW.getTime() - 23 * HOUR),
      cancelledAt: OLD,
    });
    const past = await makeSub({
      status: "CANCELLED",
      currentPeriodEnd: new Date(NOW.getTime() - 25 * HOUR),
      cancelledAt: OLD,
    });
    provider(within, { status: "active" });
    provider(past, { status: "active" });
    const s = await run();
    expect(s.counts).toEqual({ cancellation_pending: 1, cancellation_not_honoured: 1 });
    expect(finding(s, within.id)).toBeUndefined();
    expect(finding(s, past.id)?.outcomes).toEqual(["cancellation_not_honoured"]);
  });

  it("6. missed halt: local ACTIVE, Razorpay halted", async () => {
    const a = await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END });
    provider(a, { status: "halted" });
    expect(finding(await run(), a.id)?.outcomes).toEqual(["missed_halt"]);
  });

  it("7. stale billing period: Razorpay renewed, the local period did not move", async () => {
    const a = await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END });
    provider(a, { currentEnd: unix(new Date(ACTIVE_END.getTime() + 30 * DAY)) });
    const f = finding(await run(), a.id);
    expect(f?.outcomes).toEqual(["period_stale"]);
    expect(f?.localPeriodEnd).toBe(ACTIVE_END.toISOString());
    expect(f?.providerPeriodEnd).toBe(
      new Date(ACTIVE_END.getTime() + 30 * DAY).toISOString()
    );
  });

  it("8. plan and owner mismatches are reported even when the status matches", async () => {
    const a = await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END });
    provider(a, { planId: "plan_other", notesUserId: randomUUID() });
    const s = await run();
    expect(finding(s, a.id)?.outcomes).toEqual([
      "in_sync",
      "plan_mismatch",
      "owner_mismatch",
    ]);
    expect(s.attention).toEqual(["anomalies"]);
  });

  it("9. a subscription Razorpay does not know, and webhook events without a subscription", async () => {
    const ghost = await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END });
    // no provider() → not found
    for (const [pid, key] of [
      ["sub_reconunmatchedA", "a1"],
      ["sub_reconunmatchedA", "a2"],
      ["sub_reconunmatchedB", "b1"],
    ] as const) {
      const e = await db.subscriptionEvent.create({
        data: {
          provider: "RAZORPAY",
          providerEventId: `evt:recon-${randomBytes(6).toString("hex")}-${key}`,
          providerSubscriptionId: pid,
          eventType: "subscription.activated",
          payload: {
            email: "unmatched-person@example.com",
            notes: { phone: "9999999999" },
          },
          receivedAt: OLD,
        },
      });
      created.events.push(e.id);
    }

    const s = await run();
    expect(finding(s, ghost.id)?.outcomes).toEqual(["provider_missing"]);
    expect(s.counts.provider_missing).toBe(1);
    expect(s.counts.unmatched_events).toBe(3);
    expect(s.unmatchedEvents).toEqual({
      count: 3,
      providerSubscriptionIds: ["sub_reconunmatchedA", "sub_reconunmatchedB"],
    });
    expect(s.attention).toEqual(["anomalies", "unmatched_events"]);
    expect(JSON.stringify(s)).not.toContain("unmatched-person@example.com");
    expect(JSON.stringify(s)).not.toContain("9999999999");
  });

  it("10. a stuck creation is reported without calling Razorpay", async () => {
    const p = await makeSub({
      status: "PENDING_CREATION",
      providerSubscriptionId: `pending_${randomUUID()}`,
    });
    const s = await run();
    expect(fetchSub).not.toHaveBeenCalled();
    expect(s.counts.stuck_creation).toBe(1);
    expect(finding(s, p.id)).toMatchObject({
      outcomes: ["stuck_creation"],
      providerSubscriptionId: null,
      localStatus: "PENDING_CREATION",
    });
    expect(s.attention).toEqual(["stuck_creation"]);
  });
});

describe("11. provider errors and timeouts", { timeout: 30_000 }, () => {
  it("each failure is counted with its kind, and the run continues", async () => {
    const timeout = await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END });
    const http = await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END });
    const weird = await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END });
    const ok = await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END });
    providers.set(timeout.providerSubscriptionId, new RazorpayLookupError("timeout"));
    providers.set(
      http.providerSubscriptionId,
      new RazorpayLookupError("http_error", 503)
    );
    providers.set(weird.providerSubscriptionId, new Error("boom with key=abc"));
    provider(ok);

    const s = await run();
    expect(s.examined).toBe(4);
    expect(s.counts).toEqual({ provider_error: 3, in_sync: 1 });
    expect(finding(s, timeout.id)).toMatchObject({
      failure: "timeout",
      httpStatus: null,
    });
    expect(finding(s, http.id)).toMatchObject({ failure: "http_error", httpStatus: 503 });
    expect(finding(s, weird.id)).toMatchObject({ failure: "unexpected" });
    expect(JSON.stringify(s)).not.toContain("boom");
    expect(s.attention).toEqual(["errors"]);
  });
});

describe("12. mode", () => {
  it("off: Razorpay is never called and nothing is reported", async () => {
    // That off mode makes no database call at all is shown with a fake
    // database in subscriptionReconcileNoWrites.test.ts (spying on Prisma's
    // model delegates here would break them for later tests).
    await makeSub({ status: "TRIALING" });
    const s = await reconcileSubscriptions({ mode: "off", now: NOW });
    expect(s).toMatchObject({
      mode: "off",
      eligible: 0,
      examined: 0,
      counts: {},
      findings: [],
      attention: [],
    });
    expect(fetchSub).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "off"],
    ["", "off"],
    ["off", "off"],
    ["report", "report"],
    [" Report ", "report"],
    ["apply", "off"],
    ["repair", "off"],
    ["true", "off"],
  ])("SUBSCRIPTION_RECONCILE_MODE=%j → %s", (value, expected) => {
    vi.stubEnv("SUBSCRIPTION_RECONCILE_MODE", value);
    __clearServerEnvForTesting();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    expect(subscriptionReconcileModeFromEnv()).toBe(expected);
    const unknown =
      value !== undefined && !["", "off"].includes(value.trim().toLowerCase());
    expect(warn).toHaveBeenCalledTimes(unknown && expected === "off" ? 1 : 0);
    vi.unstubAllEnvs();
    __clearServerEnvForTesting();
  });
});

describe("13. bounded", { timeout: 30_000 }, () => {
  it("at most 25 lookups per run, whatever the limit asked for", async () => {
    const subs = [];
    for (let i = 0; i < 27; i++) {
      const s = await makeSub({
        status: "ACTIVE",
        currentPeriodEnd: ACTIVE_END,
        updatedAt: new Date(OLD.getTime() + i * 1000),
      });
      provider(s);
      subs.push(s);
    }
    const s = await run({ limit: 100 });
    expect(fetchSub).toHaveBeenCalledTimes(25);
    expect(s.eligible).toBe(27);
    expect(s.examined).toBe(25);
    expect(s.truncated).toBe(true);
    expect(s.attention).toContain("truncated");
    // Oldest first: the two most recently changed are left for another run.
    const looked = fetchSub.mock.calls.map((c) => c[0]);
    expect(looked).not.toContain(subs[25]!.providerSubscriptionId);
    expect(looked).not.toContain(subs[26]!.providerSubscriptionId);
  });

  it("each lookup gets at most 8 s and never more than the budget left; the run stops at the budget", async () => {
    for (let i = 0; i < 6; i++) {
      provider(
        await makeSub({
          status: "ACTIVE",
          currentPeriodEnd: ACTIVE_END,
          updatedAt: new Date(OLD.getTime() + i * 1000),
        })
      );
    }
    const timeouts: number[] = [];
    fetchSub.mockImplementation(async (id: string, opts: { timeoutMs: number }) => {
      timeouts.push(opts.timeoutMs);
      await new Promise((r) => setTimeout(r, 900));
      return providers.get(id);
    });

    const started = Date.now();
    const s = await run({ timeBudgetMs: 2_500, callTimeoutMs: 60_000 });
    const elapsed = Date.now() - started;

    expect(s.truncated).toBe(true);
    expect(s.examined).toBeLessThan(6);
    expect(elapsed).toBeLessThan(2_500 + 1_500);
    for (const t of timeouts) {
      expect(t).toBeLessThanOrEqual(2_500);
      expect(t).toBeGreaterThanOrEqual(1_000);
    }
    // Later lookups get the remaining budget, not the full per-call limit.
    expect(timeouts[timeouts.length - 1]!).toBeLessThan(timeouts[0]!);
  });

  it("the per-call limit is capped at 8 s and the budget at 20 s", async () => {
    provider(await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END }));
    await run({ callTimeoutMs: 60_000, timeBudgetMs: 120_000 });
    expect(fetchSub.mock.calls[0]![1]).toEqual({ timeoutMs: 8_000 });
  });

  it("skips records changed in the last 15 minutes, FREE, EXPIRED and long-ended cancellations", async () => {
    const fresh = await makeSub({
      status: "ACTIVE",
      currentPeriodEnd: ACTIVE_END,
      updatedAt: new Date(NOW.getTime() - 14 * 60_000),
    });
    const due = await makeSub({
      status: "ACTIVE",
      currentPeriodEnd: ACTIVE_END,
      updatedAt: new Date(NOW.getTime() - 16 * 60_000),
    });
    const free = await makeSub({ status: "ACTIVE", plan: "FREE" });
    const expired = await makeSub({ status: "EXPIRED" });
    const oldCancel = await makeSub({
      status: "CANCELLED",
      currentPeriodEnd: new Date(NOW.getTime() - 91 * DAY),
    });
    for (const x of [fresh, due, free, expired, oldCancel]) provider(x);

    const s = await run();
    expect(fetchSub.mock.calls.map((c) => c[0])).toEqual([due.providerSubscriptionId]);
    expect(s.eligible).toBe(1);
  });
});

describe(
  "14–16. read-only, no provider actions, no personal data",
  { timeout: 30_000 },
  () => {
    async function everyClass() {
      const rows = [
        await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END }),
        await makeSub({ status: "TRIALING" }),
        await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END }),
        await makeSub({
          status: "CANCELLED",
          currentPeriodEnd: new Date(NOW.getTime() - 3 * DAY),
          cancelledAt: OLD,
        }),
        await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END }),
        await makeSub({
          status: "PENDING_CREATION",
          providerSubscriptionId: `pending_${randomUUID()}`,
        }),
        await makeSub({ status: "ACTIVE", currentPeriodEnd: ACTIVE_END }),
      ];
      provider(rows[0]!);
      provider(rows[1]!, { status: "active" });
      provider(rows[2]!, {
        status: "cancelled",
        planId: "plan_x",
        notesUserId: randomUUID(),
      });
      provider(rows[3]!, { status: "active" });
      providers.set(rows[4]!.providerSubscriptionId, new RazorpayLookupError("timeout"));
      // rows[6]: unknown to Razorpay
      const e = await db.subscriptionEvent.create({
        data: {
          provider: "RAZORPAY",
          providerEventId: `evt:recon-${randomBytes(6).toString("hex")}`,
          providerSubscriptionId: "sub_reconorphan",
          eventType: "subscription.charged",
          payload: { email: rows[0]!.email },
          receivedAt: OLD,
        },
      });
      created.events.push(e.id);
      return rows;
    }

    async function snapshot() {
      const [subs, events, users] = await Promise.all([
        db.subscription.findMany({
          where: { id: { in: created.subs } },
          orderBy: { id: "asc" },
        }),
        db.subscriptionEvent.findMany({
          where: { id: { in: created.events } },
          orderBy: { id: "asc" },
        }),
        db.user.findMany({
          where: { id: { in: created.users } },
          orderBy: { id: "asc" },
        }),
      ]);
      return JSON.stringify({ subs, events, users });
    }

    it("14. a run changes nothing in the database", async () => {
      await everyClass();
      const before = await snapshot();
      const s = await run();
      expect(s.findings.length).toBeGreaterThanOrEqual(5);
      expect(await snapshot()).toBe(before);
    });

    it("15. never calls a mutating Razorpay function or the SDK", async () => {
      await everyClass();
      await run();
      expect(mutating.createRazorpaySubscription).not.toHaveBeenCalled();
      expect(mutating.cancelRazorpaySubscription).not.toHaveBeenCalled();
      expect(sdkConstructed).not.toHaveBeenCalled();
    });

    it("16. reports and logs contain identifiers only: no email, name, notes, payloads or keys", async () => {
      const rows = await everyClass();
      const logged: unknown[] = [];
      vi.spyOn(logger, "info").mockImplementation((...args) => void logged.push(args));
      vi.spyOn(logger, "warn").mockImplementation((...args) => void logged.push(args));
      vi.spyOn(logger, "error").mockImplementation((...args) => void logged.push(args));

      const s = await run();
      const out = JSON.stringify(s) + JSON.stringify(logged);
      expect(logged.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(out).not.toContain(r.email);
        expect(out).not.toContain(`Recon Person ${r.tag}`);
        expect(out).not.toContain(r.userId);
      }
      expect(out).not.toMatch(/notes|payload|email|displayName/i);
      expect(out).not.toContain(process.env.RAZORPAY_KEY_SECRET as string);
      expect(out).not.toContain(process.env.RAZORPAY_KEY_ID as string);
    });
  }
);
