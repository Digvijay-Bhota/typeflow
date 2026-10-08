/**
 * createRazorpaySubscription(): the request it sends to Razorpay.
 *
 * Regression: it used to default `total_count` to 0, which Razorpay rejects
 * ("The total count must be at least 1"), so every Pro checkout failed after
 * the local PENDING_CREATION row was written. The billing cycle count now comes
 * from the interval: 120 monthly or 10 yearly cycles, a finite 10-year horizon.
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

beforeEach(() => {
  sdk.subscriptions.create.mockReset();
  sdk.subscriptions.create.mockResolvedValue(sdkSubscription());
});

describe("getSubscriptionTotalCount", () => {
  it("is 120 cycles for monthly and 10 cycles for yearly", () => {
    expect(PRO_MONTHLY_TOTAL_COUNT).toBe(120);
    expect(PRO_YEARLY_TOTAL_COUNT).toBe(10);
    expect(getSubscriptionTotalCount("monthly")).toBe(120);
    expect(getSubscriptionTotalCount("yearly")).toBe(10);
  });

  it.each(SUBSCRIPTION_INTERVALS)(
    "%s spans a finite 10-year (120-month) horizon",
    (interval) => {
      const months =
        getSubscriptionTotalCount(interval) * getSubscriptionPeriodMonths(interval);
      expect(months).toBe(120);
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
    ["monthly", 120],
    ["yearly", 10],
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
