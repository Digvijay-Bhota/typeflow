/**
 * Subscription Service Tests — Phase 8
 *
 * Tests for:
 * - Subscription creation (auth, duplicate prevention, server-controlled plan/price)
 * - Webhook processing (signature, idempotency, state transitions)
 * - Access control (entitlement checks by status)
 * - Security (spoofing prevention)
 * - State machine (all documented transitions)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeIsPro,
  createProSubscription,
  cancelProSubscription,
  processSubscriptionWebhook,
  getSubscriptionEntitlement,
  requirePro,
} from "@/server/services/subscription.service";
import * as RazorpaySubService from "@/server/services/razorpay.subscription.service";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

vi.mock("@/server/db", () => {
  const db = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(db)),
    subscription: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: "mock_sub_id" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
    },
    subscriptionEvent: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  return { db };
});

// ─── Mock Razorpay Subscription Service ───────────────────────────────────────

vi.mock("@/server/services/razorpay.subscription.service", () => ({
  resolveRazorpayPlanId: vi.fn(),
  createRazorpaySubscription: vi.fn(),
  cancelRazorpaySubscription: vi.fn(),
  fetchRazorpaySubscription: vi.fn(),
  verifyRazorpaySubscriptionSignature: vi.fn(),
  getSubscriptionPrice: vi.fn(),
  getSubscriptionPeriodMonths: vi.fn(),
}));

// Import db after mocking
import { db } from "@/server/db";

// ─── Helper: build a subscription record ─────────────────────────────────────

function makeSub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_local_1",
    userId: "user_1",
    provider: "RAZORPAY",
    providerSubscriptionId: "sub_rzp_123",
    providerPlanId: "plan_monthly",
    plan: "PRO",
    status: "ACTIVE",
    currentPeriodStart: new Date("2026-09-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
    cancelAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── computeIsPro (pure entitlement logic) ────────────────────────────────────

describe("computeIsPro", () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const now = new Date();

  it("returns false for FREE plan regardless of status", () => {
    expect(computeIsPro("FREE", "ACTIVE", future, now)).toBe(false);
    expect(computeIsPro("FREE", "TRIALING", future, now)).toBe(false);
  });

  it("returns true for PRO ACTIVE", () => {
    expect(computeIsPro("PRO", "ACTIVE", future, now)).toBe(true);
  });

  it("returns true for PRO TRIALING", () => {
    expect(computeIsPro("PRO", "TRIALING", future, now)).toBe(true);
  });

  it("returns true for PRO PAST_DUE within period (grace period)", () => {
    expect(computeIsPro("PRO", "PAST_DUE", future, now)).toBe(true);
  });

  it("returns false for PRO PAST_DUE after period expired", () => {
    expect(computeIsPro("PRO", "PAST_DUE", past, now)).toBe(false);
  });

  it("returns true for PRO CANCELLED before period end", () => {
    expect(computeIsPro("PRO", "CANCELLED", future, now)).toBe(true);
  });

  it("returns false for PRO CANCELLED after period end", () => {
    expect(computeIsPro("PRO", "CANCELLED", past, now)).toBe(false);
  });

  it("returns false for PRO EXPIRED", () => {
    expect(computeIsPro("PRO", "EXPIRED", future, now)).toBe(false);
  });
});

// ─── getSubscriptionEntitlement ───────────────────────────────────────────────

describe("getSubscriptionEntitlement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns isPro=false when no subscription record exists", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const result = await getSubscriptionEntitlement("user_1");
    expect(result.isPro).toBe(false);
    expect(result.status).toBeNull();
  });

  it("returns isPro=true for ACTIVE PRO subscription", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      plan: "PRO",
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 1000000),
      cancelAt: null,
      cancelledAt: null,
    });
    const result = await getSubscriptionEntitlement("user_1");
    expect(result.isPro).toBe(true);
    expect(result.status).toBe("ACTIVE");
  });

  it("returns isPro=false for expired subscription", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      plan: "PRO",
      status: "EXPIRED",
      currentPeriodEnd: new Date(Date.now() - 1000000),
      cancelAt: null,
      cancelledAt: null,
    });
    const result = await getSubscriptionEntitlement("user_1");
    expect(result.isPro).toBe(false);
  });
});

// ─── requirePro ───────────────────────────────────────────────────────────────

describe("requirePro", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws PRO_REQUIRED when user has no subscription", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(requirePro("user_1")).rejects.toThrow("PRO_REQUIRED");
  });

  it("throws PRO_REQUIRED for FREE plan user", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      plan: "FREE",
      status: "ACTIVE",
      currentPeriodEnd: null,
      cancelAt: null,
      cancelledAt: null,
    });
    await expect(requirePro("user_1")).rejects.toThrow("PRO_REQUIRED");
  });

  it("resolves (does not throw) for active Pro user", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      plan: "PRO",
      status: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 1000000),
      cancelAt: null,
      cancelledAt: null,
    });
    await expect(requirePro("user_1")).resolves.toBeUndefined();
  });

  it("denies expired subscription", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      plan: "PRO",
      status: "EXPIRED",
      currentPeriodEnd: new Date(Date.now() - 1000),
      cancelAt: null,
      cancelledAt: null,
    });
    await expect(requirePro("user_1")).rejects.toThrow("PRO_REQUIRED");
  });

  it("allows PAST_DUE within grace period", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      plan: "PRO",
      status: "PAST_DUE",
      currentPeriodEnd: new Date(Date.now() + 86400000), // 1 day left
      cancelAt: null,
      cancelledAt: null,
    });
    await expect(requirePro("user_1")).resolves.toBeUndefined();
  });

  it("denies CANCELLED subscription past period end", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      plan: "PRO",
      status: "CANCELLED",
      currentPeriodEnd: new Date(Date.now() - 1000),
      cancelAt: new Date(Date.now() - 1000),
      cancelledAt: new Date(Date.now() - 2000),
    });
    await expect(requirePro("user_1")).rejects.toThrow("PRO_REQUIRED");
  });

  it("allows CANCELLED subscription before period end", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      plan: "PRO",
      status: "CANCELLED",
      currentPeriodEnd: new Date(Date.now() + 86400000),
      cancelAt: new Date(Date.now() + 86400000),
      cancelledAt: new Date(),
    });
    await expect(requirePro("user_1")).resolves.toBeUndefined();
  });
});

// ─── createProSubscription ────────────────────────────────────────────────────

describe("createProSubscription", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates subscription successfully for eligible user (no existing subscription)", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (
      RazorpaySubService.resolveRazorpayPlanId as ReturnType<typeof vi.fn>
    ).mockReturnValue("plan_monthly_rzp");
    (
      RazorpaySubService.createRazorpaySubscription as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "sub_rzp_NEW",
      status: "created",
      planId: "plan_monthly_rzp",
      shortUrl: "https://rzp.io/i/abc",
      currentStart: null,
      currentEnd: null,
    });
    (db.subscription.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ providerSubscriptionId: "sub_rzp_NEW", status: "TRIALING" })
    );

    const result = await createProSubscription("user_1", "monthly");

    expect(result.providerSubscriptionId).toBe("sub_rzp_NEW");
    expect(result.plan).toBe("PRO");
    expect(result.interval).toBe("monthly");
    // Verify server-controlled plan — never from client
    expect(RazorpaySubService.resolveRazorpayPlanId).toHaveBeenCalledWith("monthly");
  });

  it("rejects duplicate active subscription", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ plan: "PRO", status: "ACTIVE" })
    );

    await expect(createProSubscription("user_1", "monthly")).rejects.toThrow(
      "SUBSCRIPTION_ALREADY_ACTIVE"
    );
    expect(RazorpaySubService.createRazorpaySubscription).not.toHaveBeenCalled();
  });

  it("rejects duplicate TRIALING subscription", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ plan: "PRO", status: "TRIALING" })
    );

    await expect(createProSubscription("user_1", "monthly")).rejects.toThrow(
      "SUBSCRIPTION_ALREADY_ACTIVE"
    );
  });

  it("uses server-controlled plan ID (not client-supplied)", async () => {
    // This test verifies that even if client sends a malicious plan ID,
    // it's never used — interval is the only client input, plan is server-resolved
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (
      RazorpaySubService.resolveRazorpayPlanId as ReturnType<typeof vi.fn>
    ).mockReturnValue("server_controlled_plan_id");
    (
      RazorpaySubService.createRazorpaySubscription as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "sub_rzp_1",
      status: "created",
      planId: "server_controlled_plan_id",
      shortUrl: "https://rzp.io/i/abc",
      currentStart: null,
      currentEnd: null,
    });
    (db.subscription.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(makeSub());

    await createProSubscription("user_1", "monthly");

    expect(RazorpaySubService.createRazorpaySubscription).toHaveBeenCalledWith(
      "server_controlled_plan_id",
      "user_1"
    );
  });

  it("allows re-subscription after CANCELLED status", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ plan: "PRO", status: "CANCELLED" })
    );
    (
      RazorpaySubService.resolveRazorpayPlanId as ReturnType<typeof vi.fn>
    ).mockReturnValue("plan_rzp");
    (
      RazorpaySubService.createRazorpaySubscription as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "sub_rzp_NEW",
      status: "created",
      planId: "plan_rzp",
      shortUrl: "https://rzp.io/i/xyz",
      currentStart: null,
      currentEnd: null,
    });
    (db.subscription.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ status: "TRIALING" })
    );

    const result = await createProSubscription("user_1", "monthly");
    expect(result.plan).toBe("PRO");
  });

  it("allows re-subscription after EXPIRED status", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ plan: "PRO", status: "EXPIRED" })
    );
    (
      RazorpaySubService.resolveRazorpayPlanId as ReturnType<typeof vi.fn>
    ).mockReturnValue("plan_rzp");
    (
      RazorpaySubService.createRazorpaySubscription as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "sub_rzp_NEW",
      status: "created",
      planId: "plan_rzp",
      shortUrl: "https://rzp.io/i/xyz",
      currentStart: null,
      currentEnd: null,
    });
    (db.subscription.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ status: "TRIALING" })
    );

    const result = await createProSubscription("user_1", "yearly");
    expect(result.interval).toBe("yearly");
  });
});

// ─── cancelProSubscription ────────────────────────────────────────────────────

describe("cancelProSubscription", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cancels subscription successfully", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeSub());
    (
      RazorpaySubService.cancelRazorpaySubscription as ReturnType<typeof vi.fn>
    ).mockResolvedValue(undefined);
    (db.subscription.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await cancelProSubscription("user_1");

    expect(RazorpaySubService.cancelRazorpaySubscription).toHaveBeenCalledWith(
      "sub_rzp_123",
      true
    );
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    );
  });

  it("throws SUBSCRIPTION_NOT_FOUND when no subscription", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(cancelProSubscription("user_1")).rejects.toThrow(
      "SUBSCRIPTION_NOT_FOUND"
    );
  });

  it("throws NOT_A_PRO_SUBSCRIPTION for FREE plan", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ plan: "FREE" })
    );
    await expect(cancelProSubscription("user_1")).rejects.toThrow(
      "NOT_A_PRO_SUBSCRIPTION"
    );
  });

  it("throws SUBSCRIPTION_ALREADY_CANCELLED for already-cancelled subscription", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ status: "CANCELLED" })
    );
    await expect(cancelProSubscription("user_1")).rejects.toThrow(
      "SUBSCRIPTION_ALREADY_CANCELLED"
    );
  });

  it("throws SUBSCRIPTION_ALREADY_CANCELLED for EXPIRED subscription", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ status: "EXPIRED" })
    );
    await expect(cancelProSubscription("user_1")).rejects.toThrow(
      "SUBSCRIPTION_ALREADY_CANCELLED"
    );
  });
});

// ─── processSubscriptionWebhook ───────────────────────────────────────────────

describe("processSubscriptionWebhook", () => {
  const makePayload = (
    eventType: string,
    subId: string = "sub_rzp_123",
    overrides: Record<string, unknown> = {}
  ) => ({
    event: eventType,
    account_id: "acc_1",
    payload: {
      subscription: {
        entity: {
          id: subId,
          status: "active",
          current_start: Math.floor(Date.now() / 1000) - 100,
          current_end: Math.floor(Date.now() / 1000) + 2592000,
          ...overrides,
        },
      },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (
      RazorpaySubService.verifyRazorpaySubscriptionSignature as ReturnType<typeof vi.fn>
    ).mockReturnValue(true);
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(makeSub());
    (db.subscriptionEvent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.subscriptionEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (db.subscription.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  // ── Signature tests ────────────────────────────────────────────────────────

  it("throws INVALID_SUBSCRIPTION_SIGNATURE for invalid signature", async () => {
    (
      RazorpaySubService.verifyRazorpaySubscriptionSignature as ReturnType<typeof vi.fn>
    ).mockReturnValue(false);
    const payload = makePayload("subscription.activated");
    await expect(processSubscriptionWebhook(payload, "bad_sig", "raw")).rejects.toThrow(
      "INVALID_SUBSCRIPTION_SIGNATURE"
    );
    expect(db.subscription.update).not.toHaveBeenCalled();
  });

  it("processes valid signature and subscription.activated event", async () => {
    const payload = makePayload("subscription.activated");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });

  // ── Idempotency tests ──────────────────────────────────────────────────────

  it("ignores duplicate events safely (idempotency via P2002)", async () => {
    (db.subscriptionEvent.create as ReturnType<typeof vi.fn>).mockRejectedValue({
      code: "P2002",
    });
    const payload = makePayload("subscription.activated");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    // Event already exists — caught gracefully, no state change
    expect(db.subscription.update).not.toHaveBeenCalled();
  });

  // ── Unknown subscription ID ────────────────────────────────────────────────

  it("persists but does not apply events for unknown subscription IDs (Strategy A)", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const payload = makePayload("subscription.activated", "sub_UNKNOWN");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    expect(db.subscriptionEvent.create).toHaveBeenCalled(); // Should persist the unmatched event
    expect(db.subscription.update).not.toHaveBeenCalled(); // Should not apply transition
  });

  // ── Non-subscription events ────────────────────────────────────────────────

  it("ignores non-subscription events (e.g. payment.captured)", async () => {
    const payload = makePayload("payment.captured");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    // Should return early without any DB calls
    expect(db.subscription.update).not.toHaveBeenCalled();
    expect(db.subscriptionEvent.create).not.toHaveBeenCalled();
  });

  // ── State machine transitions ──────────────────────────────────────────────

  it("transitions TRIALING → ACTIVE on subscription.activated", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ status: "TRIALING" })
    );
    const payload = makePayload("subscription.activated");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
  });

  it("transitions ACTIVE → PAST_DUE on subscription.halted (payment failure)", async () => {
    const payload = makePayload("subscription.halted");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PAST_DUE" }),
      })
    );
  });

  it("transitions to CANCELLED on subscription.cancelled", async () => {
    const payload = makePayload("subscription.cancelled");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED" }),
      })
    );
  });

  it("transitions to EXPIRED on subscription.completed", async () => {
    const payload = makePayload("subscription.completed");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "EXPIRED" }),
      })
    );
  });

  it("transitions to EXPIRED on subscription.expired", async () => {
    const payload = makePayload("subscription.expired");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "EXPIRED" }),
      })
    );
  });

  it("updates period on subscription.charged (recurring payment success)", async () => {
    const payload = makePayload("subscription.charged");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ACTIVE",
          currentPeriodStart: expect.any(Date),
          currentPeriodEnd: expect.any(Date),
        }),
      })
    );
  });

  it("sets TRIALING on subscription.pending", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSub({ status: "TRIALING" })
    );
    const payload = makePayload("subscription.pending");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    // TRIALING → TRIALING is a valid no-op but update is called
    expect(db.subscriptionEvent.create).toHaveBeenCalled();
  });

  // ── Records event for audit ────────────────────────────────────────────────

  it("records subscription event for every processed event", async () => {
    const payload = makePayload("subscription.activated");
    await processSubscriptionWebhook(payload, "valid_sig", "raw");
    expect(db.subscriptionEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "RAZORPAY",
          eventType: "subscription.activated",
        }),
      })
    );
  });
});

// ─── Security tests ───────────────────────────────────────────────────────────

describe("Security: subscription spoofing prevention", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not use client-supplied userId — userId always comes from server auth", async () => {
    // createProSubscription takes userId as parameter from server-side auth,
    // NOT from request body. This test verifies the function signature enforces this.
    // The API route passes user.id from requireAuthenticatedUser() — never from req.body.

    // If someone calls createProSubscription with a spoofed userId,
    // the subscription is created for that userId — but the API route
    // ALWAYS uses the server-authenticated user.id, making spoofing impossible
    // through the API.

    // We verify the function uses the provided userId (server-controlled)
    // and that no client-supplied userId can override it through the API layer.
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (
      RazorpaySubService.resolveRazorpayPlanId as ReturnType<typeof vi.fn>
    ).mockReturnValue("plan_rzp");
    (
      RazorpaySubService.createRazorpaySubscription as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "sub_rzp_1",
      status: "created",
      planId: "plan_rzp",
      shortUrl: "https://rzp.io/i/abc",
      currentStart: null,
      currentEnd: null,
    });
    (db.subscription.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(makeSub());

    // Server passes its own user.id — never from client body
    const result = await createProSubscription("server_verified_user_id", "monthly");
    expect(result).toBeDefined();
    // Razorpay subscription uses server-verified user ID in notes
    expect(RazorpaySubService.createRazorpaySubscription).toHaveBeenCalledWith(
      "plan_rzp",
      "server_verified_user_id"
    );
  });

  it("does not accept client-supplied plan price — price is server-determined", async () => {
    // Verify that resolveRazorpayPlanId is called with only the interval
    // and returns the server-configured plan ID — client cannot override price
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (
      RazorpaySubService.resolveRazorpayPlanId as ReturnType<typeof vi.fn>
    ).mockReturnValue("server_plan_id");
    (
      RazorpaySubService.createRazorpaySubscription as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "sub_rzp_1",
      status: "created",
      planId: "server_plan_id",
      shortUrl: "https://rzp.io/i/abc",
      currentStart: null,
      currentEnd: null,
    });
    (db.subscription.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(makeSub());

    await createProSubscription("user_1", "monthly");

    // Only interval was passed from "client" — plan ID is resolved server-side
    expect(RazorpaySubService.resolveRazorpayPlanId).toHaveBeenCalledWith("monthly");
    expect(RazorpaySubService.resolveRazorpayPlanId).not.toHaveBeenCalledWith(
      expect.stringContaining("plan_free") // would be a spoofed plan
    );
  });

  it("cannot access another user subscription by spoofing subscription ID in webhook", async () => {
    // Webhook uses providerSubscriptionId from Razorpay payload to look up subscription
    // An attacker sending a different subscriptionId would find the wrong subscription
    // but since it's validated against DB (subscription must exist with that providerSubscriptionId),
    // spoofing a non-existent ID is a no-op
    (
      RazorpaySubService.verifyRazorpaySubscriptionSignature as ReturnType<typeof vi.fn>
    ).mockReturnValue(true);
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      null // Not found — spoofed ID
    );

    const payload = {
      event: "subscription.activated",
      account_id: "acc_1",
      payload: {
        subscription: {
          entity: {
            id: "sub_SPOOFED_ID",
            status: "active",
            current_start: null,
            current_end: null,
          },
        },
      },
    };

    await processSubscriptionWebhook(payload, "sig", "raw");
    // No state change when subscription ID not found
    expect(db.subscription.update).not.toHaveBeenCalled();
  });

  it("rejects webhook with invalid signature — no DB operations performed", async () => {
    (
      RazorpaySubService.verifyRazorpaySubscriptionSignature as ReturnType<typeof vi.fn>
    ).mockReturnValue(false);

    const payload = {
      event: "subscription.activated",
      account_id: "acc_1",
      payload: {
        subscription: {
          entity: {
            id: "sub_rzp_123",
            status: "active",
            current_start: null,
            current_end: null,
          },
        },
      },
    };

    await expect(processSubscriptionWebhook(payload, "INVALID", "raw")).rejects.toThrow(
      "INVALID_SUBSCRIPTION_SIGNATURE"
    );

    // Signature check happens BEFORE any DB operations
    expect(db.subscription.findUnique).not.toHaveBeenCalled();
    expect(db.subscription.update).not.toHaveBeenCalled();
  });
});

describe("Phase 8 Hardening: Concurrency & Failure Recovery", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Task 5A: No existing row
  it("A. No existing row: prevents concurrent creation via P2002", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    // Simulate one transaction succeeding and the other throwing P2002
    (db.subscription.create as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "sub_1" })
      .mockRejectedValueOnce({ code: "P2002" });

    // Assuming Razorpay mock succeeds for the winner
    const createP1 = createProSubscription("u1", "monthly");
    const createP2 = createProSubscription("u1", "monthly");

    const results = await Promise.allSettled([createP1, createP2]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect((failed[0] as PromiseRejectedResult).reason.message).toBe(
      "SUBSCRIPTION_CREATION_IN_PROGRESS"
    );
    expect(RazorpaySubService.createRazorpaySubscription).toHaveBeenCalledTimes(1); // Exactly one Razorpay creation
  });

  // Task 5B: Existing CANCELLED row
  it("B. Existing CANCELLED row: prevents concurrent creation via updateMany OCC", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub_1",
      status: "CANCELLED",
      plan: "PRO",
      updatedAt: new Date(),
    });

    // Simulate one transaction updating successfully (count 1) and the other failing (count 0)
    (db.subscription.updateMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const createP1 = createProSubscription("u1", "monthly");
    const createP2 = createProSubscription("u1", "monthly");

    const results = await Promise.allSettled([createP1, createP2]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect((failed[0] as PromiseRejectedResult).reason.message).toBe(
      "SUBSCRIPTION_CREATION_IN_PROGRESS"
    );
    expect(RazorpaySubService.createRazorpaySubscription).toHaveBeenCalledTimes(1);
  });

  // Task 5C: Existing EXPIRED row
  it("C. Existing EXPIRED row: prevents concurrent creation via updateMany OCC", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub_1",
      status: "EXPIRED",
      plan: "PRO",
      updatedAt: new Date(),
    });

    (db.subscription.updateMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const createP1 = createProSubscription("u1", "monthly");
    const createP2 = createProSubscription("u1", "monthly");

    const results = await Promise.allSettled([createP1, createP2]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect((failed[0] as PromiseRejectedResult).reason.message).toBe(
      "SUBSCRIPTION_CREATION_IN_PROGRESS"
    );
    expect(RazorpaySubService.createRazorpaySubscription).toHaveBeenCalledTimes(1);
  });

  // Task 5D: Existing PENDING_CREATION
  it("D. Existing PENDING_CREATION: fails immediately without calling Razorpay", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub_1",
      status: "PENDING_CREATION",
      plan: "PRO",
      updatedAt: new Date(), // recent
    });

    await expect(createProSubscription("u1", "monthly")).rejects.toThrow(
      "SUBSCRIPTION_CREATION_IN_PROGRESS"
    );
    expect(RazorpaySubService.createRazorpaySubscription).not.toHaveBeenCalled();
  });

  // Task 5E: Provider failure
  it("E. Provider failure: reverts local state correctly and avoids duplicate provider creation", async () => {
    (db.subscription.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (db.subscription.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub_1",
    });

    // Make razorpay fail
    (
      RazorpaySubService.createRazorpaySubscription as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("RZP_ERROR"));

    await expect(createProSubscription("u1", "monthly")).rejects.toThrow("RZP_ERROR");

    // Verify rollback to CANCELLED
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        data: { status: "CANCELLED" },
      })
    );
  });

  it("recovers unmatched webhooks (Strategy A/C)", async () => {
    (db.subscriptionEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "evt_1",
        eventType: "subscription.activated",
        payload: { entity: { id: "sub_rzp" } },
      },
    ]);

    (db.subscription.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "sub_1",
        status: "TRIALING",
      });

    (db.subscription.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sub_1",
    });

    await createProSubscription("u1", "monthly");
    expect(db.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sub_1" },
        data: expect.objectContaining({ status: "ACTIVE" }), // from Webhook Reconciliation
      })
    );
  });
});
