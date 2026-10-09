/**
 * classifySubscription: every local status against every Razorpay status,
 * the cancel-at-period-end grace window, the renewal check, and plan / owner
 * mismatches. Pure: no database, no network.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: {} }));

import {
  classifySubscription,
  subscriptionReconcileAttention,
  SUBSCRIPTION_RECONCILE_DEFAULTS,
  type LocalSubscriptionForReconcile,
} from "@/server/services/subscription.reconciliation.service";
import type { RazorpaySubscriptionSnapshot } from "@/server/services/razorpay.subscription.service";

const NOW = new Date("2026-10-10T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

const local = (over: Partial<LocalSubscriptionForReconcile> = {}) => ({
  status: "ACTIVE",
  userId: "user-1",
  providerPlanId: "plan_A",
  currentPeriodEnd: new Date(NOW.getTime() + 10 * DAY),
  cancelledAt: null,
  updatedAt: new Date(NOW.getTime() - 20 * DAY),
  ...over,
});

const provider = (over: Partial<RazorpaySubscriptionSnapshot> = {}) => ({
  id: "sub_1",
  status: "active",
  planId: "plan_A",
  currentStart: unix(new Date(NOW.getTime() - 20 * DAY)),
  currentEnd: unix(new Date(NOW.getTime() + 10 * DAY)),
  endedAt: null,
  paidCount: 1,
  notesUserId: "user-1",
  ...over,
});

const classify = (
  l: Partial<LocalSubscriptionForReconcile>,
  p: Partial<RazorpaySubscriptionSnapshot>,
  now = NOW
) => classifySubscription(local(l), provider(p), now);

describe("status matrix", () => {
  it.each([
    // local TRIALING (unpaid)
    ["TRIALING", "created", "in_sync"],
    ["TRIALING", "authenticated", "in_sync"],
    ["TRIALING", "pending", "in_sync"],
    ["TRIALING", "active", "missed_activation"],
    ["TRIALING", "halted", "missed_halt"],
    ["TRIALING", "cancelled", "missed_cancellation"],
    ["TRIALING", "completed", "missed_cancellation"],
    ["TRIALING", "expired", "missed_cancellation"],
    // local ACTIVE (paid)
    ["ACTIVE", "active", "in_sync"],
    ["ACTIVE", "pending", "in_sync"], // retrying a failed charge; the webhook keeps ACTIVE
    ["ACTIVE", "halted", "missed_halt"],
    ["ACTIVE", "cancelled", "missed_cancellation"],
    ["ACTIVE", "completed", "missed_cancellation"],
    ["ACTIVE", "expired", "missed_cancellation"],
    ["ACTIVE", "created", "status_conflict"],
    ["ACTIVE", "authenticated", "status_conflict"],
    // local PAST_DUE (grace)
    ["PAST_DUE", "halted", "in_sync"],
    ["PAST_DUE", "pending", "in_sync"],
    // same period end as the local one: no evidence of a new payment (see below)
    ["PAST_DUE", "active", "activation_unconfirmed"],
    ["PAST_DUE", "cancelled", "missed_cancellation"],
    ["PAST_DUE", "created", "status_conflict"],
    // local CANCELLED, Razorpay ended
    ["CANCELLED", "cancelled", "in_sync"],
    ["CANCELLED", "completed", "in_sync"],
    ["CANCELLED", "expired", "in_sync"],
    // anything unrecognised
    ["ACTIVE", "paused", "status_conflict"],
    ["EXPIRED", "active", "status_conflict"],
    ["PENDING_CREATION", "active", "status_conflict"],
  ])("local %s, Razorpay %s → %s", (localStatus, providerStatus, expected) => {
    expect(classify({ status: localStatus }, { status: providerStatus }).status).toBe(
      expected
    );
  });
});

describe("missed_activation needs payment evidence", () => {
  const later = (d: Date) => unix(new Date(d.getTime() + 30 * DAY));
  const localEnd = new Date(NOW.getTime() + 10 * DAY);

  describe("local TRIALING, Razorpay active", () => {
    it.each([
      [1, "missed_activation"],
      [3, "missed_activation"],
      [0, "activation_unconfirmed"],
      [null, "activation_unconfirmed"],
    ] as const)("paid_count %j → %s", (paidCount, expected) => {
      expect(
        classify({ status: "TRIALING" }, { status: "active", paidCount }).status
      ).toBe(expected);
    });

    it("a paid_count that is not a number is no evidence", () => {
      const p = { status: "active", paidCount: "1" as unknown as number };
      expect(classify({ status: "TRIALING" }, p).status).toBe("activation_unconfirmed");
    });
  });

  describe("local PAST_DUE, Razorpay active (recovered payment)", () => {
    it("paid_count > 0 and a Razorpay period ending after the local one → missed_activation", () => {
      expect(
        classify(
          { status: "PAST_DUE", currentPeriodEnd: localEnd },
          { status: "active", paidCount: 2, currentEnd: later(localEnd) }
        ).status
      ).toBe("missed_activation");
    });

    const cases: [string, number | null, number | null][] = [
      ["the same period end", 2, unix(localEnd)],
      [
        "a period end within the 1 h tolerance",
        2,
        unix(new Date(localEnd.getTime() + HOUR - 1000)),
      ],
      ["no Razorpay period end", 2, null],
      ["paid_count 0, even with a later period", 0, later(localEnd)],
      ["paid_count missing, even with a later period", null, later(localEnd)],
    ];
    it.each(cases)("%s → activation_unconfirmed", (_label, paidCount, currentEnd) => {
      expect(
        classify(
          { status: "PAST_DUE", currentPeriodEnd: localEnd },
          { status: "active", paidCount, currentEnd }
        ).status
      ).toBe("activation_unconfirmed");
    });

    it("no local paid period: paid_count > 0 alone is the evidence", () => {
      expect(
        classify(
          { status: "PAST_DUE", currentPeriodEnd: null },
          { status: "active", paidCount: 1 }
        ).status
      ).toBe("missed_activation");
      for (const paidCount of [0, null]) {
        expect(
          classify(
            { status: "PAST_DUE", currentPeriodEnd: null },
            { status: "active", paidCount }
          ).status
        ).toBe("activation_unconfirmed");
      }
    });
  });

  it("activation_unconfirmed is an anomaly to check, not a confirmed finding", () => {
    expect(
      subscriptionReconcileAttention({
        counts: { activation_unconfirmed: 1 },
        truncated: false,
      })
    ).toEqual(["anomalies"]);
  });

  it("other classes do not depend on paid_count", () => {
    expect(classify({}, { paidCount: 0 }).status).toBe("in_sync");
    expect(
      classify({ status: "ACTIVE" }, { status: "cancelled", paidCount: null }).status
    ).toBe("missed_cancellation");
  });
});

describe("cancel at period end: 24-hour grace", () => {
  const periodEnd = new Date(NOW.getTime() - 2 * DAY);
  const at = (offsetMs: number) => new Date(periodEnd.getTime() + offsetMs);

  it.each(["active", "pending", "halted", "authenticated", "created"])(
    "Razorpay %s: pending until 24 h after the local period end, then not honoured",
    (providerStatus) => {
      const l = { status: "CANCELLED", currentPeriodEnd: periodEnd };
      const p = { status: providerStatus };
      expect(classify(l, p, at(-5 * DAY)).status).toBe("cancellation_pending");
      expect(classify(l, p, at(0)).status).toBe("cancellation_pending");
      expect(classify(l, p, at(DAY)).status).toBe("cancellation_pending");
      expect(classify(l, p, at(DAY + 1)).status).toBe("cancellation_not_honoured");
    }
  );

  it("the grace is 24 hours", () => {
    expect(SUBSCRIPTION_RECONCILE_DEFAULTS.cancellationGraceMs).toBe(DAY);
  });

  it("without a paid period, the grace runs from the cancellation", () => {
    const cancelledAt = new Date(NOW.getTime() - 3 * HOUR);
    const l = { status: "CANCELLED", currentPeriodEnd: null, cancelledAt };
    expect(classify(l, {}, NOW).status).toBe("cancellation_pending");
    expect(classify(l, {}, new Date(cancelledAt.getTime() + DAY + 1)).status).toBe(
      "cancellation_not_honoured"
    );
  });
});

describe("renewal (period_stale)", () => {
  const end = new Date(NOW.getTime() + 10 * DAY);

  it("a later Razorpay period end than the local one is a missed renewal", () => {
    const next = unix(new Date(end.getTime() + 30 * DAY));
    expect(classify({ currentPeriodEnd: end }, { currentEnd: next }).status).toBe(
      "period_stale"
    );
  });

  it("within an hour is not", () => {
    const close = unix(new Date(end.getTime() + HOUR - 1000));
    expect(classify({ currentPeriodEnd: end }, { currentEnd: close }).status).toBe(
      "in_sync"
    );
  });

  it("an ACTIVE subscription without a local period end is stale", () => {
    expect(classify({ currentPeriodEnd: null }, {}).status).toBe("period_stale");
  });
});

describe("plan and owner", () => {
  it("in sync when both match", () => {
    expect(classify({}, {})).toEqual({ status: "in_sync", anomalies: [] });
  });

  it("a different plan is a plan_mismatch", () => {
    expect(classify({}, { planId: "plan_B" }).anomalies).toEqual(["plan_mismatch"]);
  });

  it("a different notes.userId is an owner_mismatch", () => {
    expect(classify({}, { notesUserId: "user-2" }).anomalies).toEqual(["owner_mismatch"]);
  });

  it("both, alongside the status class", () => {
    expect(
      classify({ status: "TRIALING" }, { planId: "plan_B", notesUserId: "user-2" })
    ).toEqual({
      status: "missed_activation",
      anomalies: ["plan_mismatch", "owner_mismatch"],
    });
  });

  it("missing values on either side are not mismatches", () => {
    expect(classify({ providerPlanId: null }, { planId: "plan_B" }).anomalies).toEqual(
      []
    );
    expect(classify({}, { planId: null, notesUserId: null }).anomalies).toEqual([]);
  });
});

describe("attention", () => {
  const att = (counts: Record<string, number>, truncated = false) =>
    subscriptionReconcileAttention({ counts, truncated });

  it("a clean run needs none", () => {
    expect(att({ in_sync: 3, cancellation_pending: 1 })).toEqual([]);
  });

  it("lists each reason once, in a fixed order", () => {
    expect(
      att(
        {
          provider_error: 1,
          missed_activation: 1,
          owner_mismatch: 1,
          stuck_creation: 2,
          unmatched_events: 4,
        },
        true
      )
    ).toEqual([
      "errors",
      "findings",
      "anomalies",
      "stuck_creation",
      "unmatched_events",
      "truncated",
    ]);
  });

  it.each([
    "missed_activation",
    "missed_cancellation",
    "missed_halt",
    "cancellation_not_honoured",
    "period_stale",
  ])("%s is a finding", (o) => {
    expect(att({ [o]: 1 })).toEqual(["findings"]);
  });

  it.each([
    "activation_unconfirmed",
    "plan_mismatch",
    "owner_mismatch",
    "provider_missing",
    "status_conflict",
  ])("%s is an anomaly", (o) => {
    expect(att({ [o]: 1 })).toEqual(["anomalies"]);
  });
});
