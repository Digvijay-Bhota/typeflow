/**
 * Razorpay Subscription Service
 *
 * Handles subscription-specific Razorpay API calls.
 * SEPARATE from razorpay.service.ts which handles one-time certificate payments.
 *
 * Design: Clean service boundary — no cross-contamination with one-time payment logic.
 */
import Razorpay from "razorpay";
import { getServerEnv } from "@/lib/env";
import { createHmac } from "crypto";
import {
  PRO_MONTHLY_PRICE_PAISE,
  PRO_YEARLY_PRICE_PAISE,
  PRO_MONTHLY_PERIOD,
  PRO_YEARLY_PERIOD,
  type SubscriptionInterval,
} from "@/lib/constants";

// ─── Razorpay client (subscription-scoped singleton) ─────────────────────────

let rzpSubscriptionClient: Razorpay | undefined;

function getRazorpayClient(): Razorpay {
  if (!rzpSubscriptionClient) {
    const env = getServerEnv();
    rzpSubscriptionClient = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
  }
  return rzpSubscriptionClient;
}

// ─── Plan ID resolution ───────────────────────────────────────────────────────

/**
 * Resolve the server-configured Razorpay Plan ID for a given billing interval.
 *
 * NEVER accept plan IDs from the client.
 * If the env variable is not set, the function throws — subscription creation
 * will fail gracefully and be reported as a configuration error.
 */
export function resolveRazorpayPlanId(interval: SubscriptionInterval): string {
  const env = getServerEnv();

  if (interval === "monthly") {
    const planId = env.RAZORPAY_PLAN_ID_PRO_MONTHLY;
    if (!planId) {
      throw new Error(
        "RAZORPAY_PLAN_ID_PRO_MONTHLY is not configured. " +
          "Set this environment variable to enable Pro Monthly subscriptions."
      );
    }
    return planId;
  }

  if (interval === "yearly") {
    const planId = env.RAZORPAY_PLAN_ID_PRO_YEARLY;
    if (!planId) {
      throw new Error(
        "RAZORPAY_PLAN_ID_PRO_YEARLY is not configured. " +
          "Set this environment variable to enable Pro Yearly subscriptions."
      );
    }
    return planId;
  }

  throw new Error(`Unknown subscription interval: ${interval as string}`);
}

/**
 * Returns the server-authoritative price in paise for a billing interval.
 * NEVER trust client-supplied amounts.
 */
export function getSubscriptionPrice(interval: SubscriptionInterval): number {
  if (interval === "monthly") return PRO_MONTHLY_PRICE_PAISE;
  if (interval === "yearly") return PRO_YEARLY_PRICE_PAISE;
  throw new Error(`Unknown subscription interval: ${interval as string}`);
}

/**
 * Returns the subscription period in months for a billing interval.
 */
export function getSubscriptionPeriodMonths(
  interval: SubscriptionInterval
): number {
  if (interval === "monthly") return PRO_MONTHLY_PERIOD;
  if (interval === "yearly") return PRO_YEARLY_PERIOD;
  throw new Error(`Unknown subscription interval: ${interval as string}`);
}

// ─── Razorpay API calls ───────────────────────────────────────────────────────

export interface RazorpaySubscriptionResult {
  id: string;
  status: string;
  planId: string;
  shortUrl: string;
  currentStart?: number | null;
  currentEnd?: number | null;
}

/**
 * Create a Razorpay subscription.
 *
 * @param planId   Server-resolved Razorpay plan ID (never from client)
 * @param userId   Internal user ID (for notes/tracking only, not trust-critical)
 * @param totalCount Number of billing cycles (0 = unlimited)
 */
export async function createRazorpaySubscription(
  planId: string,
  userId: string,
  totalCount: number = 0
): Promise<RazorpaySubscriptionResult> {
  const rzp = getRazorpayClient();

  const sub = await rzp.subscriptions.create({
    plan_id: planId,
    total_count: totalCount,
    quantity: 1,
    notes: {
      userId,
    },
  });

  return {
    id: sub.id,
    status: sub.status,
    planId: sub.plan_id,
    shortUrl: (sub as unknown as Record<string, string>).short_url ?? "",
    currentStart:
      (sub as unknown as Record<string, number | null | undefined>)
        .current_start ?? null,
    currentEnd:
      (sub as unknown as Record<string, number | null | undefined>)
        .current_end ?? null,
  };
}

/**
 * Cancel a Razorpay subscription.
 * cancel_at_cycle_end=1 means cancel at end of current period (user retains access).
 * cancel_at_cycle_end=0 means cancel immediately.
 */
export async function cancelRazorpaySubscription(
  providerSubscriptionId: string,
  atPeriodEnd: boolean = true
): Promise<void> {
  const rzp = getRazorpayClient();
  await rzp.subscriptions.cancel(
    providerSubscriptionId,
    atPeriodEnd ? true : false
  );
}

/**
 * Fetch a Razorpay subscription by ID.
 */
export async function fetchRazorpaySubscription(
  providerSubscriptionId: string
): Promise<RazorpaySubscriptionResult> {
  const rzp = getRazorpayClient();
  const sub = await rzp.subscriptions.fetch(providerSubscriptionId);

  return {
    id: sub.id,
    status: sub.status,
    planId: sub.plan_id,
    shortUrl: (sub as unknown as Record<string, string>).short_url ?? "",
    currentStart:
      (sub as unknown as Record<string, number | null | undefined>)
        .current_start ?? null,
    currentEnd:
      (sub as unknown as Record<string, number | null | undefined>)
        .current_end ?? null,
  };
}

// ─── Webhook signature verification ──────────────────────────────────────────

/**
 * Verify a Razorpay webhook signature for subscription events.
 *
 * Uses the SAME webhook secret as one-time payments (Razorpay uses one
 * webhook endpoint per account by default). This function is duplicated
 * here to maintain clean service boundaries and allow future divergence.
 */
export function verifyRazorpaySubscriptionSignature(
  payloadStr: string,
  signature: string
): boolean {
  const env = getServerEnv();
  const secret = env.RAZORPAY_WEBHOOK_SECRET;

  const expectedSignature = createHmac("sha256", secret)
    .update(payloadStr)
    .digest("hex");

  return expectedSignature === signature;
}
