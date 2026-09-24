/**
 * Razorpay subscription webhooks against real Postgres: idempotency enforced by
 * the unique subscription_events.providerEventId, with no time-based keys.
 *
 * Payloads follow Razorpay's webhook shape (entity, account_id, event,
 * contains, payload.subscription.entity{ id, status, current_start?,
 * current_end? }, created_at).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHmac, randomBytes, randomUUID } from "crypto";
import { db } from "@/server/db";
import { __clearServerEnvForTesting } from "@/lib/env";
import { processSubscriptionWebhook } from "@/server/services/subscription.service";

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
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

async function seedSubscription(
  status: "PENDING_CREATION" | "ACTIVE" = "PENDING_CREATION"
) {
  const tag = randomBytes(4).toString("hex");
  const user = await db.user.create({
    data: { authId: randomUUID(), email: `sub-${tag}@example.com` },
  });
  const sub = await db.subscription.create({
    data: { userId: user.id, providerSubscriptionId: `sub_${tag}`, status },
  });
  return {
    tag,
    subscriptionRowId: sub.id,
    providerSubscriptionId: sub.providerSubscriptionId!,
  };
}

function delivery(
  providerSubscriptionId: string,
  event: string,
  entity: { status: string; current_start?: number; current_end?: number }
) {
  const payload = {
    entity: "event",
    account_id: "acc_TEST000000001",
    event,
    contains: ["subscription"],
    payload: { subscription: { entity: { id: providerSubscriptionId, ...entity } } },
    created_at: 1790200000,
  };
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET as string)
    .update(raw)
    .digest("hex");
  return { payload, raw, signature };
}

const deliver = (d: ReturnType<typeof delivery>, eventId?: string | null) =>
  processSubscriptionWebhook(d.payload, d.signature, d.raw, eventId);

const eventsFor = (providerSubscriptionId: string) =>
  db.subscriptionEvent.findMany({ where: { providerSubscriptionId } });

describe("subscription webhook — idempotency", () => {
  it("processes the same event delivered twice sequentially exactly once", async () => {
    const s = await seedSubscription();
    const d = delivery(s.providerSubscriptionId, "subscription.activated", {
      status: "active",
      current_end: 1792800000,
    });
    await deliver(d, `evt_seq_${s.tag}`);
    await deliver(d, `evt_seq_${s.tag}`);

    const events = await eventsFor(s.providerSubscriptionId);
    expect(events).toHaveLength(1);
    expect(events[0]!.providerEventId).toBe(`evt:evt_seq_${s.tag}`);
    const sub = await db.subscription.findUniqueOrThrow({
      where: { id: s.subscriptionRowId },
    });
    expect(sub.status).toBe("ACTIVE");
  });

  it("treats concurrent duplicate deliveries as duplicates, not errors", async () => {
    const s = await seedSubscription();
    const d = delivery(s.providerSubscriptionId, "subscription.activated", {
      status: "active",
    });

    const outcomes = await Promise.allSettled(
      Array.from({ length: 4 }, () => deliver(d, `evt_cc_${s.tag}`))
    );

    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);
    expect(await eventsFor(s.providerSubscriptionId)).toHaveLength(1);
  });

  it("dedupes a redelivered event that has no current_end and no event-id header", async () => {
    // The old key fell back to Date.now() here, so every redelivery was "new".
    const s = await seedSubscription("ACTIVE");
    const d = delivery(s.providerSubscriptionId, "subscription.charged", {
      status: "active",
    });
    await deliver(d, null);
    await new Promise((r) => setTimeout(r, 5));
    await deliver(d, null);

    const events = await eventsFor(s.providerSubscriptionId);
    expect(events).toHaveLength(1);
    expect(events[0]!.providerEventId).toMatch(/^body:[0-9a-f]{64}$/);
  });

  it("does not collapse distinct renewal events for the same subscription", async () => {
    const s = await seedSubscription("ACTIVE");
    await deliver(
      delivery(s.providerSubscriptionId, "subscription.charged", {
        status: "active",
        current_end: 1792800000,
      }),
      `evt_r1_${s.tag}`
    );
    await deliver(
      delivery(s.providerSubscriptionId, "subscription.charged", {
        status: "active",
        current_end: 1795400000,
      }),
      `evt_r2_${s.tag}`
    );

    expect(await eventsFor(s.providerSubscriptionId)).toHaveLength(2);
    const sub = await db.subscription.findUniqueOrThrow({
      where: { id: s.subscriptionRowId },
    });
    expect(sub.currentPeriodEnd?.getTime()).toBe(1795400000 * 1000);
  });
});
