/**
 * createRazorpaySubscription(): the request it sends to Razorpay.
 *
 * Regression: it used to default `total_count` to 0, which Razorpay rejects
 * ("The total count must be at least 1"), so every Pro checkout failed after
 * the local PENDING_CREATION row was written. The billing cycle count now comes
 * from the interval: 468 monthly or 39 yearly cycles, a 39-year horizon (a
 * practical upper bound, not a promised contract length).
 *
 * Regression: a 100-year horizon (1200 / 100 cycles) created the subscription,
 * but Razorpay's hosted checkout then refused it with "expire_at cannot be
 * more than 40 years". Both intervals must stay below 40 years.
 * The SDK is mocked; no request leaves the process.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sdk = vi.hoisted(() => ({
  subscriptions: { create: vi.fn() },
}));

vi.mock("razorpay", () => ({ default: vi.fn(() => sdk) }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ RAZORPAY_KEY_ID: "rzp_test_fake", RAZORPAY_KEY_SECRET: "fake" }),
}));

import {
  createRazorpaySubscription,
  getSubscriptionPeriodMonths,
  getSubscriptionTotalCount,
} from "@/server/services/razorpay.subscription.service";
import {
  PRO_MONTHLY_TOTAL_COUNT,
  PRO_YEARLY_TOTAL_COUNT,
  SUBSCRIPTION_INTERVALS,
  type SubscriptionInterval,
} from "@/lib/constants";

/** A subscription entity as POST /v1/subscriptions returns it (fake values). */
function sdkSubscription(over: Record<string, unknown> = {}) {
  return {
    id: "sub_FAKE00000001",
    entity: "subscription",
    plan_id: "plan_FAKE00000001",
    status: "created",
    short_url: "https://rzp.io/i/FAKE",
    current_start: null,
    current_end: null,
    ...over,
  };
}

/** Razorpay checkout rejects subscriptions whose expire_at is 40 or more years out. */
const RAZORPAY_CHECKOUT_MAX_YEARS = 40;

beforeEach(() => {
  sdk.subscriptions.create.mockReset();
  sdk.subscriptions.create.mockResolvedValue(sdkSubscription());
});

describe("getSubscriptionTotalCount", () => {
  it("is 468 cycles for monthly and 39 cycles for yearly", () => {
    expect(PRO_MONTHLY_TOTAL_COUNT).toBe(468);
    expect(PRO_YEARLY_TOTAL_COUNT).toBe(39);
    expect(getSubscriptionTotalCount("monthly")).toBe(468);
    expect(getSubscriptionTotalCount("yearly")).toBe(39);
  });

  it.each(SUBSCRIPTION_INTERVALS)("%s is a positive integer", (interval) => {
    const count = getSubscriptionTotalCount(interval);
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it.each(SUBSCRIPTION_INTERVALS)(
    "%s spans 39 years, below Razorpay checkout's 40-year limit",
    (interval) => {
      const months =
        getSubscriptionTotalCount(interval) * getSubscriptionPeriodMonths(interval);
      expect(months).toBe(39 * 12);
      expect(months).toBeLessThan(RAZORPAY_CHECKOUT_MAX_YEARS * 12);
    }
  );

  it.each(SUBSCRIPTION_INTERVALS)(
    "%s ends before the 40-year mark from any start date",
    (interval) => {
      const months =
        getSubscriptionTotalCount(interval) * getSubscriptionPeriodMonths(interval);
      // Month-end and leap-day starts are where calendar arithmetic drifts.
      for (const start of ["2026-01-31", "2028-02-29", "2026-10-09"]) {
        const startAt = new Date(`${start}T00:00:00Z`);
        const expireAt = new Date(startAt);
        expireAt.setUTCMonth(expireAt.getUTCMonth() + months);
        const limit = new Date(startAt);
        limit.setUTCFullYear(limit.getUTCFullYear() + RAZORPAY_CHECKOUT_MAX_YEARS);
        expect(expireAt.getTime()).toBeLessThan(limit.getTime());
      }
    }
  );

  it("throws for an unknown interval instead of returning a count", () => {
    expect(() => getSubscriptionTotalCount("weekly" as SubscriptionInterval)).toThrow(
      "Unknown subscription interval"
    );
  });
});

describe("createRazorpaySubscription", () => {
  it.each([
    ["monthly", 468],
    ["yearly", 39],
  ] as const)("sends total_count %s → %i", async (interval, totalCount) => {
    await createRazorpaySubscription("plan_FAKE00000001", "user_1", interval);

    expect(sdk.subscriptions.create).toHaveBeenCalledTimes(1);
    expect(sdk.subscriptions.create).toHaveBeenCalledWith({
      plan_id: "plan_FAKE00000001",
      total_count: totalCount,
      quantity: 1,
      notes: { userId: "user_1" },
    });
  });

  it.each(SUBSCRIPTION_INTERVALS)(
    "never sends a zero, negative or non-integer total_count (%s)",
    async (interval) => {
      await createRazorpaySubscription("plan_FAKE00000001", "user_1", interval);

      const body = sdk.subscriptions.create.mock.calls[0]?.[0] as {
        total_count: unknown;
      };
      expect(Number.isInteger(body.total_count)).toBe(true);
      expect(body.total_count).toBeGreaterThanOrEqual(1);
      expect(body.total_count).not.toBe(0);
    }
  );

  it("does not call Razorpay for an unknown interval", async () => {
    await expect(
      createRazorpaySubscription(
        "plan_FAKE00000001",
        "user_1",
        "weekly" as SubscriptionInterval
      )
    ).rejects.toThrow("Unknown subscription interval");
    expect(sdk.subscriptions.create).not.toHaveBeenCalled();
  });

  it("maps the created subscription, including the hosted checkout short_url", async () => {
    const result = await createRazorpaySubscription(
      "plan_FAKE00000001",
      "user_1",
      "monthly"
    );

    expect(result).toEqual({
      id: "sub_FAKE00000001",
      status: "created",
      planId: "plan_FAKE00000001",
      shortUrl: "https://rzp.io/i/FAKE",
      currentStart: null,
      currentEnd: null,
    });
  });
});
