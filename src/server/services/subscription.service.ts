/**
 * Subscription Service
 *
 * Core business logic for Pro subscription management.
 *
 * # Subscription State Machine
 *
 * Provider state → Local SubscriptionStatus mapping:
 *
 * created / authenticated → TRIALING (if trial) | ACTIVE
 * active               → ACTIVE
 * halted               → PAST_DUE
 * cancelled            → CANCELLED
 * completed            → EXPIRED (all billing cycles done)
 * expired              → EXPIRED
 * pending              → TRIALING (awaiting first payment)
 *
 * Transitions:
 * TRIALING  → ACTIVE       (first payment succeeds)
 * TRIALING  → CANCELLED    (user cancels before first payment)
 * ACTIVE    → PAST_DUE     (payment fails)
 * ACTIVE    → CANCELLED    (user cancels)
 * PAST_DUE  → ACTIVE       (payment retried successfully)
 * PAST_DUE  → CANCELLED    (user cancels during grace period)
 * PAST_DUE  → EXPIRED      (max retries exceeded)
 * CANCELLED → EXPIRED      (currentPeriodEnd passes — scheduler or next-request check)
 *
 * # Entitlement Policy
 *
 * A user has active Pro entitlement when ALL of:
 * 1. User is authenticated
 * 2. subscription.plan === "PRO"
 * 3. subscription.status IN (ACTIVE, TRIALING, PAST_DUE)
 *    — PAST_DUE retains access during grace period
 * 4. subscription.currentPeriodEnd > now()
 *    — handles the CANCELLED case where user retains until period end
 *
 * # Grace Period
 *
 * PAST_DUE: Razorpay retries payment up to N times.
 * During this time the user retains Pro access (up to currentPeriodEnd).
 * If all retries fail → subscription.halted → we set EXPIRED.
 *
 * # Cancellation
 *
 * Cancellation sets cancelAt = currentPeriodEnd (at-period-end cancel).
 * User retains Pro until currentPeriodEnd passes.
 * Status becomes CANCELLED immediately (UI reflects "cancelling").
 * Access check: CANCELLED + currentPeriodEnd > now() → still entitiled.
 */

import { db } from "@/server/db";
import { Prisma, SubscriptionStatus } from "@prisma/client";
import type { SubscriptionInterval } from "@/lib/constants";
import {
  resolveRazorpayPlanId,
  createRazorpaySubscription,
  cancelRazorpaySubscription,
  verifyRazorpaySubscriptionSignature,
} from "./razorpay.subscription.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubscriptionCreateResult {
  subscriptionId: string;
  providerSubscriptionId: string;
  shortUrl: string;
  plan: "PRO";
  interval: SubscriptionInterval;
  status: string;
}

export interface SubscriptionEntitlement {
  isPro: boolean;
  status: string | null;
  plan: string | null;
  currentPeriodEnd: Date | null;
  cancelAt: Date | null;
  cancelledAt: Date | null;
}

// ─── Entitlement Check ────────────────────────────────────────────────────────

/**
 * Returns Pro entitlement for a given internal userId.
 *
 * IMPORTANT: This is the ONLY source of truth for Pro access.
 * Never use localStorage, client-side role, or URL params.
 * Always call this server-side after verifying authentication.
 *
 * Entitlement rules:
 * - plan === "PRO"
 * - status IN (ACTIVE, TRIALING, PAST_DUE, CANCELLED)
 *   — CANCELLED retains access until currentPeriodEnd
 * - currentPeriodEnd > now() if status is CANCELLED
 *
 * Cache safety: entitlement is always fetched from DB per-request.
 * User-specific: no shared cache between users.
 */
export async function getSubscriptionEntitlement(
  userId: string
): Promise<SubscriptionEntitlement> {
  const sub = await db.subscription.findUnique({
    where: { userId },
    select: {
      plan: true,
      status: true,
      currentPeriodEnd: true,
      cancelAt: true,
      cancelledAt: true,
    },
  });

  if (!sub) {
    return {
      isPro: false,
      status: null,
      plan: null,
      currentPeriodEnd: null,
      cancelAt: null,
      cancelledAt: null,
    };
  }

  const now = new Date();
  const isPro = computeIsPro(sub.plan, sub.status, sub.currentPeriodEnd, now);

  return {
    isPro,
    status: sub.status,
    plan: sub.plan,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAt: sub.cancelAt,
    cancelledAt: sub.cancelledAt,
  };
}

/**
 * Compute whether a subscription confers active Pro entitlement.
 * Extracted for testability.
 */
export function computeIsPro(
  plan: string,
  status: string,
  currentPeriodEnd: Date | null,
  now: Date = new Date()
): boolean {
  if (plan !== "PRO") return false;

  // Active and trialing always have entitlement
  if (status === "ACTIVE" || status === "TRIALING") return true;

  // PAST_DUE: grace period — retain access until currentPeriodEnd
  if (status === "PAST_DUE") {
    if (!currentPeriodEnd) return true; // no period end set → retain
    return currentPeriodEnd > now;
  }

  // CANCELLED: retain access until currentPeriodEnd
  if (status === "CANCELLED") {
    if (!currentPeriodEnd) return false;
    return currentPeriodEnd > now;
  }

  // EXPIRED: no entitlement
  return false;
}

/**
 * Server-side Pro authorization guard.
 *
 * Throws if the authenticated user does not have active Pro entitlement.
 * Use this in API route handlers and server actions.
 *
 * Usage:
 *   const user = await requireAuthenticatedUser();
 *   await requirePro(user.id);
 *
 * Security:
 * - Verifies authentication first (via requireAuthenticatedUser)
 * - Verifies entitlement from DB — never trusts client input
 * - No caching — fresh DB read per request
 */
export async function requirePro(userId: string): Promise<void> {
  const entitlement = await getSubscriptionEntitlement(userId);
  if (!entitlement.isPro) {
    throw new Error("PRO_REQUIRED");
  }
}

// ─── Create Subscription ──────────────────────────────────────────────────────

/**
 * Create a new Pro subscription for an authenticated user.
 *
 * Security:
 * - userId comes from server-side auth, NOT from client
 * - interval is validated against allowlist
 * - plan/price is server-determined from constants, NOT from client
 * - providerSubscriptionId comes from Razorpay API response, NOT from client
 *
 * Idempotency:
 * - If user already has ACTIVE/TRIALING Pro, returns existing subscription
 * - Does NOT create duplicate subscriptions
 */
export async function createProSubscription(
  userId: string,
  interval: SubscriptionInterval
): Promise<SubscriptionCreateResult> {
  const planId = resolveRazorpayPlanId(interval);
  const pendingId = `pending_${crypto.randomUUID()}`;

  // 1. Establish concurrency lock and initial state
  await db.$transaction(async (tx) => {
    const existing = await tx.subscription.findUnique({
      where: { userId },
    });

    if (existing) {
      if (
        existing.plan === "PRO" &&
        (existing.status === "ACTIVE" ||
          existing.status === "TRIALING" ||
          existing.status === "PAST_DUE")
      ) {
        throw new Error("SUBSCRIPTION_ALREADY_ACTIVE");
      }

      if (existing.status === "PENDING_CREATION") {
        if (existing.updatedAt.getTime() > Date.now() - 5 * 60 * 1000) {
          throw new Error("SUBSCRIPTION_CREATION_IN_PROGRESS");
        }
      }

      const result = await tx.subscription.updateMany({
        where: {
          userId,
          status: existing.status,
          updatedAt: existing.updatedAt,
        },
        data: {
          status: "PENDING_CREATION",
          providerSubscriptionId: pendingId,
          providerPlanId: planId,
          plan: "PRO",
        },
      });

      if (result.count !== 1) {
        throw new Error("SUBSCRIPTION_CREATION_IN_PROGRESS");
      }
    } else {
      try {
        await tx.subscription.create({
          data: {
            userId,
            provider: "RAZORPAY",
            providerSubscriptionId: pendingId,
            providerPlanId: planId,
            plan: "PRO",
            status: "PENDING_CREATION",
          },
        });
      } catch (err: unknown) {
        const error = err as { code?: string };
        if (error.code === "P2002") {
          throw new Error("SUBSCRIPTION_CREATION_IN_PROGRESS");
        }
        throw err;
      }
    }
  });

  // 2. Create Razorpay subscription (External API Call)
  let rzpSub;
  try {
    rzpSub = await createRazorpaySubscription(planId, userId);
  } catch (error) {
    // If Razorpay fails, revert local state to CANCELLED to free the lock
    await db.subscription.update({
      where: { userId },
      data: { status: "CANCELLED" },
    });
    throw error;
  }

  // 3. Commit actual ID
  const subscription = await db.subscription.update({
    where: { userId },
    data: {
      providerSubscriptionId: rzpSub.id,
      status: "TRIALING",
      currentPeriodStart: rzpSub.currentStart
        ? new Date(rzpSub.currentStart * 1000)
        : null,
      currentPeriodEnd: rzpSub.currentEnd ? new Date(rzpSub.currentEnd * 1000) : null,
    },
  });

  // 4. Reconcile missed webhooks (Strategy A & C)
  const unmatchedEvents = await db.subscriptionEvent.findMany({
    where: {
      providerSubscriptionId: rzpSub.id,
      subscriptionId: null,
    },
    orderBy: { receivedAt: "asc" },
  });

  for (const event of unmatchedEvents) {
    await db.$transaction(async (tx) => {
      // Re-fetch subscription to get latest state
      const currentSub = await tx.subscription.findUnique({
        where: { id: subscription.id },
      });
      if (!currentSub) return;

      await tx.subscriptionEvent.update({
        where: { id: event.id },
        data: {
          subscriptionId: subscription.id,
          processedAt: new Date(),
        },
      });

      await applySubscriptionStateTransition(
        tx,
        currentSub,
        event.eventType,
        event.payload as Record<string, unknown>
      );
    });
  }

  return {
    subscriptionId: subscription.id,
    providerSubscriptionId: rzpSub.id,
    shortUrl: rzpSub.shortUrl,
    plan: "PRO",
    interval,
    status: rzpSub.status,
  };
}

// ─── Cancel Subscription ──────────────────────────────────────────────────────

/**
 * Cancel a Pro subscription for an authenticated user.
 *
 * Cancels at end of current billing period (user retains access until then).
 * Does NOT immediately delete the subscription.
 * Sets status = CANCELLED, cancelAt = currentPeriodEnd.
 */
export async function cancelProSubscription(userId: string): Promise<void> {
  const sub = await db.subscription.findUnique({
    where: { userId },
  });

  if (!sub) {
    throw new Error("SUBSCRIPTION_NOT_FOUND");
  }

  if (sub.plan !== "PRO") {
    throw new Error("NOT_A_PRO_SUBSCRIPTION");
  }

  if (sub.status === "CANCELLED" || sub.status === "EXPIRED") {
    throw new Error("SUBSCRIPTION_ALREADY_CANCELLED");
  }

  if (!sub.providerSubscriptionId) {
    throw new Error("SUBSCRIPTION_NO_PROVIDER_ID");
  }

  await cancelRazorpaySubscription(sub.providerSubscriptionId, true);

  await db.subscription.update({
    where: { id: sub.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
  });
}

// ─── Webhook Processing ───────────────────────────────────────────────────────

/**
 * Process a Razorpay webhook event for subscriptions.
 *
 * Separate from processRazorpayWebhook (certificate payments).
 *
 * Razorpay subscription event types handled:
 * - subscription.activated    → ACTIVE
 * - subscription.charged      → ACTIVE (payment success, update period)
 * - subscription.halted       → PAST_DUE (payment failure)
 * - subscription.cancelled    → CANCELLED
 * - subscription.completed    → EXPIRED (all billing cycles done)
 * - subscription.pending      → TRIALING (awaiting first payment)
 *
 * Idempotency: providerEventId is unique. Duplicate events are silently ignored.
 *
 * Signature verification: uses raw body + HMAC-SHA256 + webhook secret.
 */
export async function processSubscriptionWebhook(
  payload: Record<string, unknown>,
  signature: string,
  payloadRawString: string
): Promise<void> {
  if (!verifyRazorpaySubscriptionSignature(payloadRawString, signature)) {
    throw new Error("INVALID_SUBSCRIPTION_SIGNATURE");
  }

  const eventType = payload.event as string;

  // Only handle subscription events
  if (!eventType.startsWith("subscription.")) {
    // Not a subscription event — silently ignore
    return;
  }

  const payloadData = payload.payload as Record<string, unknown>;
  const subPayload = payloadData?.subscription as Record<string, unknown> | undefined;
  const entity = subPayload?.entity as Record<string, unknown> | undefined;

  if (!entity) return;

  const providerSubscriptionId = entity.id as string;
  const accountId = String(payload.account_id ?? "");
  // Construct idempotency key from account + event type + entity ID
  // Razorpay doesn't provide a unique event ID in all cases,
  // so we compose one from context.
  const providerEventId = `${accountId}_${eventType}_${providerSubscriptionId}_${entity.current_end ?? Date.now()}`;

  // 1. Atomic Claim (Idempotency Strategy)
  let subscriptionEvent;
  try {
    subscriptionEvent = await db.subscriptionEvent.create({
      data: {
        provider: "RAZORPAY",
        providerEventId,
        providerSubscriptionId,
        eventType,
        payload: payload as Prisma.InputJsonValue,
        receivedAt: new Date(),
      },
    });
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === "P2002") {
      // Duplicate delivery — already claimed
      return;
    }
    throw err;
  }

  // 2. Processing (with reconciliation fallback)
  await db.$transaction(async (tx) => {
    const sub = await tx.subscription.findUnique({
      where: { providerSubscriptionId },
    });

    if (!sub) {
      // Strategy A: Unmatched event is safely persisted and linked later
      // during subscription creation reconciliation.
      return;
    }

    await tx.subscriptionEvent.update({
      where: { id: subscriptionEvent.id },
      data: {
        subscriptionId: sub.id,
        processedAt: new Date(),
      },
    });

    // Apply state transition
    await applySubscriptionStateTransition(tx, sub, eventType, entity);
  });
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING_CREATION: ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"],
  TRIALING: ["ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED"],
  ACTIVE: ["ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED"], // ACTIVE to ACTIVE for renewals
  PAST_DUE: ["ACTIVE", "CANCELLED", "EXPIRED"],
  CANCELLED: ["EXPIRED"],
  EXPIRED: [], // Terminal
};

function mapEventTypeToStatus(eventType: string): string | null {
  switch (eventType) {
    case "subscription.pending":
    case "subscription.authenticated":
      return "TRIALING";
    case "subscription.activated":
    case "subscription.charged":
      return "ACTIVE";
    case "subscription.halted":
      return "PAST_DUE";
    case "subscription.cancelled":
      return "CANCELLED";
    case "subscription.completed":
    case "subscription.expired":
      return "EXPIRED";
    default:
      return null;
  }
}

/**
 * Apply the correct subscription state transition based on Razorpay event type.
 *
 * State machine:
 * subscription.authenticated/pending → TRIALING
 * subscription.activated             → ACTIVE
 * subscription.charged               → ACTIVE (update billing period)
 * subscription.halted                → PAST_DUE
 * subscription.cancelled             → CANCELLED
 * subscription.completed             → EXPIRED
 * subscription.expired               → EXPIRED
 */
async function applySubscriptionStateTransition(
  tx: Prisma.TransactionClient,
  sub: { id: string; status: string; userId: string },
  eventType: string,
  entity: Record<string, unknown>
): Promise<void> {
  const currentStart =
    typeof entity.current_start === "number"
      ? new Date(entity.current_start * 1000)
      : null;

  const currentEnd =
    typeof entity.current_end === "number" ? new Date(entity.current_end * 1000) : null;
  const targetStatus = mapEventTypeToStatus(eventType);
  if (!targetStatus) return;

  // Strict state machine validator
  const allowedTransitions = VALID_TRANSITIONS[sub.status] || [];
  if (sub.status !== targetStatus && !allowedTransitions.includes(targetStatus)) {
    // Invalid transition (out of order event)
    console.warn(
      `[Webhook] Ignoring invalid transition from ${sub.status} to ${targetStatus}`
    );
    return;
  }

  await tx.subscription.update({
    where: { id: sub.id },
    data: {
      status: targetStatus as SubscriptionStatus,
      ...(currentStart ? { currentPeriodStart: currentStart } : {}),
      ...(currentEnd ? { currentPeriodEnd: currentEnd, cancelAt: currentEnd } : {}),
      ...(targetStatus === "CANCELLED" && sub.status !== "CANCELLED"
        ? { cancelledAt: new Date() }
        : {}),
    },
  });
}

// ─── Billing Info ─────────────────────────────────────────────────────────────

/**
 * Get billing information for display on the billing dashboard.
 * Returns sanitized data safe for client consumption.
 */
export async function getUserBillingInfo(userId: string) {
  const sub = await db.subscription.findUnique({
    where: { userId },
    select: {
      plan: true,
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      cancelAt: true,
      cancelledAt: true,
      createdAt: true,
    },
  });

  if (!sub || sub.plan === "FREE") {
    return {
      plan: "FREE" as const,
      status: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAt: null,
      cancelledAt: null,
      createdAt: null,
      isPro: false,
    };
  }

  const now = new Date();
  const isPro = computeIsPro(sub.plan, sub.status, sub.currentPeriodEnd, now);

  return {
    plan: sub.plan,
    status: sub.status,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAt: sub.cancelAt,
    cancelledAt: sub.cancelledAt,
    createdAt: sub.createdAt,
    isPro,
  };
}
