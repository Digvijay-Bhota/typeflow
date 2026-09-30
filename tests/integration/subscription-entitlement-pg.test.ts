/**
 * Pro entitlement follows payment, against real Postgres.
 *
 * Regression: createProSubscription saved the provider's `created` (unpaid)
 * subscription as TRIALING, and computeIsPro treated TRIALING as Pro — so
 * starting a checkout and never paying granted Pro. No trial is offered, so:
 *
 *   created / authenticated / pending (unpaid)  → not Pro
 *   activated / charged (paid)                  → Pro
 *   halted / cancelled after the paid period, completed, expired → not Pro
 *
 * Unpaid events carry period dates too; they must not create a paid period
 * that PAST_DUE or CANCELLED would then stay entitled for.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHmac, randomBytes, randomUUID } from "crypto";
import { db } from "@/server/db";
import { __clearServerEnvForTesting } from "@/lib/env";
import {
  createProSubscription,
  getSubscriptionEntitlement,
  processSubscriptionWebhook,
  requirePro,
} from "@/server/services/subscription.service";

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));

// Only the provider calls are faked; signature verification stays real.
const createRazorpaySubscription = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/razorpay.subscription.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/services/razorpay.subscription.service")
  >()),
  resolveRazorpayPlanId: vi.fn(() => "plan_test_monthly"),
  createRazorpaySubscription,
}));

// Test-only placeholders for getServerEnv(), used only when the variable is
// not already provided (CI sets real test values). Restored after the file.
const TEST_ENV: Record<string, string> = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "test-only-supabase-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-supabase-service-role-key",
  RAZORPAY_KEY_ID: "rzp_test_placeholder",
  RAZORPAY_KEY_SECRET: "test-only-razorpay-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "test-only-razorpay-webhook-secret",
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "test-only-session-secret-not-for-production",
  CERTIFICATE_SIGNING_SECRET: "test-only-certificate-signing-secret-not-for-production",
};

beforeAll(() => {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (!process.env[key]) vi.stubEnv(key, value);
  }
  __clearServerEnvForTesting();
});

afterAll(() => {
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});

const nowSec = () => Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;

/**
 * A user who has started (not paid for) a Pro subscription. `responsePeriod`
 * puts billing-period dates in the provider's creation response.
 */
async function startCheckout(
  responsePeriod: { currentStart: number; currentEnd: number } | null = null
) {
  const tag = randomBytes(4).toString("hex");
  const user = await db.user.create({
    data: { authId: randomUUID(), email: `ent-${tag}@example.com` },
  });
  const providerSubscriptionId = `sub_ent_${tag}`;
  createRazorpaySubscription.mockResolvedValueOnce({
    id: providerSubscriptionId,
    status: "created",
    planId: "plan_test_monthly",
    shortUrl: `https://rzp.io/i/${tag}`,
    currentStart: responsePeriod?.currentStart ?? null,
    currentEnd: responsePeriod?.currentEnd ?? null,
  });
  await createProSubscription(user.id, "monthly");
  return { tag, userId: user.id, providerSubscriptionId };
}

function deliver(
  providerSubscriptionId: string,
  event: string,
  entity: { status: string; current_start?: number; current_end?: number },
  eventId: string
) {
  const payload = {
    entity: "event",
    account_id: "acc_TEST000000001",
    event,
    contains: ["subscription"],
    payload: { subscription: { entity: { id: providerSubscriptionId, ...entity } } },
    created_at: nowSec(),
  };
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET as string)
    .update(raw)
    .digest("hex");
  return processSubscriptionWebhook(payload, signature, raw, eventId);
}

const isPro = async (userId: string) => (await getSubscriptionEntitlement(userId)).isPro;

describe("Pro entitlement — unpaid subscriptions", () => {
  it("does not grant Pro to a created subscription that was never paid", async () => {
    const s = await startCheckout();

    const sub = await db.subscription.findUniqueOrThrow({ where: { userId: s.userId } });
    expect(sub.status).toBe("TRIALING");
    expect(await isPro(s.userId)).toBe(false);
    await expect(requirePro(s.userId)).rejects.toThrow("PRO_REQUIRED");
  });

  it("creates the subscription with no paid period, even if the creation response has dates", async () => {
    const s = await startCheckout({
      currentStart: nowSec(),
      currentEnd: nowSec() + 30 * DAY,
    });

    const sub = await db.subscription.findUniqueOrThrow({ where: { userId: s.userId } });
    expect(sub.status).toBe("TRIALING");
    expect(sub.currentPeriodStart).toBeNull();
    expect(sub.currentPeriodEnd).toBeNull();
    expect(sub.cancelAt).toBeNull();
    expect(await isPro(s.userId)).toBe(false);

    // Nothing for a later unpaid event to turn into entitlement.
    await deliver(
      s.providerSubscriptionId,
      "subscription.halted",
      { status: "halted" },
      `evt_halt_${s.tag}`
    );
    expect(await isPro(s.userId)).toBe(false);
  });

  it("does not grant Pro on authenticated or pending, even with period dates", async () => {
    const s = await startCheckout();
    const period = { current_start: nowSec(), current_end: nowSec() + 30 * DAY };

    await deliver(
      s.providerSubscriptionId,
      "subscription.authenticated",
      { status: "authenticated", ...period },
      `evt_auth_${s.tag}`
    );
    await deliver(
      s.providerSubscriptionId,
      "subscription.pending",
      { status: "pending", ...period },
      `evt_pend_${s.tag}`
    );

    expect(await isPro(s.userId)).toBe(false);
  });

  it("does not grant Pro when an unpaid subscription is halted or cancelled", async () => {
    for (const [event, status] of [
      ["subscription.halted", "halted"],
      ["subscription.cancelled", "cancelled"],
    ] as const) {
      const s = await startCheckout();
      await deliver(
        s.providerSubscriptionId,
        event,
        { status, current_start: nowSec(), current_end: nowSec() + 30 * DAY },
        `evt_${status}_${s.tag}`
      );

      const sub = await db.subscription.findUniqueOrThrow({
        where: { userId: s.userId },
      });
      expect(sub.currentPeriodEnd, event).toBeNull();
      expect(await isPro(s.userId), event).toBe(false);
    }
  });
});

describe("Pro entitlement — paid subscriptions", () => {
  it("grants Pro once activated, and keeps it through a renewal", async () => {
    const s = await startCheckout();
    await deliver(
      s.providerSubscriptionId,
      "subscription.activated",
      { status: "active", current_start: nowSec(), current_end: nowSec() + 30 * DAY },
      `evt_act_${s.tag}`
    );
    expect(await isPro(s.userId)).toBe(true);
    await expect(requirePro(s.userId)).resolves.toBeUndefined();

    await deliver(
      s.providerSubscriptionId,
      "subscription.charged",
      {
        status: "active",
        current_start: nowSec() + 30 * DAY,
        current_end: nowSec() + 60 * DAY,
      },
      `evt_chg_${s.tag}`
    );
    expect(await isPro(s.userId)).toBe(true);
  });

  it("keeps the paid period through halted, and ends Pro when it lapses", async () => {
    const s = await startCheckout();
    const paidEnd = nowSec() + 2 * DAY;
    await deliver(
      s.providerSubscriptionId,
      "subscription.charged",
      { status: "active", current_start: nowSec() - 28 * DAY, current_end: paidEnd },
      `evt_chg_${s.tag}`
    );
    // The halted payload's (unpaid) cycle must not extend the paid period.
    await deliver(
      s.providerSubscriptionId,
      "subscription.halted",
      { status: "halted", current_start: paidEnd, current_end: paidEnd + 30 * DAY },
      `evt_halt_${s.tag}`
    );

    const sub = await db.subscription.findUniqueOrThrow({ where: { userId: s.userId } });
    expect(sub.status).toBe("PAST_DUE");
    expect(sub.currentPeriodEnd?.getTime()).toBe(paidEnd * 1000);
    expect(await isPro(s.userId)).toBe(true); // grace: paid period not over yet

    await db.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: new Date(Date.now() - 1000) },
    });
    expect(await isPro(s.userId)).toBe(false);
  });

  it("ends Pro on completed and expired", async () => {
    for (const event of ["subscription.completed", "subscription.expired"]) {
      const s = await startCheckout();
      await deliver(
        s.providerSubscriptionId,
        "subscription.activated",
        { status: "active", current_start: nowSec(), current_end: nowSec() + 30 * DAY },
        `evt_act_${s.tag}`
      );
      await deliver(
        s.providerSubscriptionId,
        event,
        { status: event.split(".")[1]! },
        `evt_end_${s.tag}`
      );
      expect(await isPro(s.userId), event).toBe(false);
    }
  });
});
