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
import { createHmac, timingSafeEqual } from "crypto";
import {
  PRO_MONTHLY_PRICE_PAISE,
  PRO_YEARLY_PRICE_PAISE,
  PRO_MONTHLY_PERIOD,
  PRO_YEARLY_PERIOD,
  PRO_MONTHLY_TOTAL_COUNT,
  PRO_YEARLY_TOTAL_COUNT,
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
export function getSubscriptionPeriodMonths(interval: SubscriptionInterval): number {
  if (interval === "monthly") return PRO_MONTHLY_PERIOD;
  if (interval === "yearly") return PRO_YEARLY_PERIOD;
  throw new Error(`Unknown subscription interval: ${interval as string}`);
}

/**
 * Returns the number of billing cycles (Razorpay `total_count`) for a billing
 * interval: a 39-year horizon, inside Razorpay checkout's 40-year limit, never 0.
 * See PRO_MONTHLY_TOTAL_COUNT.
 */
export function getSubscriptionTotalCount(interval: SubscriptionInterval): number {
  if (interval === "monthly") return PRO_MONTHLY_TOTAL_COUNT;
  if (interval === "yearly") return PRO_YEARLY_TOTAL_COUNT;
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
 * The number of billing cycles comes from the interval, never from the
 * caller: Razorpay rejects `total_count: 0`, so there is no default to fall
 * back to.
 *
 * @param planId   Server-resolved Razorpay plan ID (never from client)
 * @param userId   Internal user ID (for notes/tracking only, not trust-critical)
 * @param interval Billing interval of the plan; decides `total_count`
 */
export async function createRazorpaySubscription(
  planId: string,
  userId: string,
  interval: SubscriptionInterval
): Promise<RazorpaySubscriptionResult> {
  const totalCount = getSubscriptionTotalCount(interval);
  if (!Number.isInteger(totalCount) || totalCount < 1) {
    throw new Error(`Invalid subscription total_count: ${totalCount}`);
  }
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
      (sub as unknown as Record<string, number | null | undefined>).current_start ?? null,
    currentEnd:
      (sub as unknown as Record<string, number | null | undefined>).current_end ?? null,
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
  await rzp.subscriptions.cancel(providerSubscriptionId, atPeriodEnd ? true : false);
}

// ─── Read-only subscription lookup (bounded) ─────────────────────────────────

const RAZORPAY_API_BASE = "https://api.razorpay.com";

/** Per-lookup deadline when the caller sets none. */
export const RAZORPAY_LOOKUP_TIMEOUT_MS = 8_000;

const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{1,64}$/;

export type RazorpayLookupFailure =
  | "not_found"
  | "timeout"
  | "http_error"
  | "network_error"
  | "invalid_response";

/**
 * A failed lookup. Carries the kind of failure and the HTTP status only, never
 * the response body or the request (which holds the credentials).
 */
export class RazorpayLookupError extends Error {
  constructor(
    readonly kind: RazorpayLookupFailure,
    readonly status: number | null = null
  ) {
    super(`Razorpay subscription lookup failed: ${kind}${status ? ` (${status})` : ""}`);
    this.name = "RazorpayLookupError";
  }
}

/** The fields the reconciliation compares; nothing else is kept. */
export interface RazorpaySubscriptionSnapshot {
  id: string;
  status: string;
  planId: string | null;
  currentStart: number | null;
  currentEnd: number | null;
  endedAt: number | null;
  paidCount: number | null;
  /** notes.userId set at creation (createRazorpaySubscription). */
  notesUserId: string | null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

/**
 * Fetch a Razorpay subscription by ID (GET /v1/subscriptions/:id), read-only.
 *
 * Uses fetch rather than the SDK because razorpay-node 2.9.8 has no timeout or
 * cancellation: its axios instance is created without `timeout` or `signal`,
 * resource methods take no per-request options, and an error without a
 * response (a timeout) surfaces only as a TypeError. Here the whole exchange,
 * response body included, runs under one AbortSignal.timeout, so a stalled
 * request is aborted and its connection closed at the deadline; it is not
 * merely stopped being awaited.
 *
 * Throws RazorpayLookupError: `not_found` for an unknown ID, `timeout`,
 * `http_error`, `network_error` or `invalid_response`.
 */
export async function fetchRazorpaySubscription(
  providerSubscriptionId: string,
  options: { timeoutMs?: number; baseUrl?: string } = {}
): Promise<RazorpaySubscriptionSnapshot> {
  if (!SUBSCRIPTION_ID.test(providerSubscriptionId)) {
    throw new RazorpayLookupError("not_found");
  }
  const env = getServerEnv();
  const timeoutMs = Math.max(1, options.timeoutMs ?? RAZORPAY_LOOKUP_TIMEOUT_MS);
  const signal = AbortSignal.timeout(timeoutMs);
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString(
    "base64"
  );

  let status: number;
  let body: string;
  try {
    const res = await fetch(
      `${options.baseUrl ?? RAZORPAY_API_BASE}/v1/subscriptions/${providerSubscriptionId}`,
      {
        method: "GET",
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
        signal,
        cache: "no-store",
      }
    );
    status = res.status;
    body = await res.text(); // still under the same deadline
  } catch {
    throw new RazorpayLookupError(signal.aborted ? "timeout" : "network_error");
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new RazorpayLookupError("invalid_response", status);
  }

  if (status < 200 || status >= 300) {
    // Razorpay answers an unknown ID with 400 BAD_REQUEST_ERROR "The id
    // provided does not exist" (404 is treated the same).
    const description = (data as { error?: { description?: unknown } } | null)?.error
      ?.description;
    const unknownId =
      status === 404 ||
      (status === 400 &&
        typeof description === "string" &&
        /does not exist/i.test(description));
    throw new RazorpayLookupError(unknownId ? "not_found" : "http_error", status);
  }

  const sub = data as Record<string, unknown>;
  if (sub.id !== providerSubscriptionId || typeof sub.status !== "string") {
    throw new RazorpayLookupError("invalid_response", status);
  }
  const notes = sub.notes && typeof sub.notes === "object" ? sub.notes : {};
  return {
    id: sub.id,
    status: sub.status,
    planId: str(sub.plan_id),
    currentStart: num(sub.current_start),
    currentEnd: num(sub.current_end),
    endedAt: num(sub.ended_at),
    paidCount: num(sub.paid_count),
    notesUserId: str((notes as Record<string, unknown>).userId),
  };
}

// ─── Webhook signature verification ──────────────────────────────────────────

/**
 * Verify a Razorpay webhook signature for subscription events.
 *
 * Uses the SAME webhook secret as one-time payments (Razorpay uses one
 * webhook endpoint per account by default). This function is duplicated
 * here to maintain clean service boundaries and allow future divergence.
 *
 * Compared in constant time. Accepts exactly the lowercase hex digest;
 * anything malformed is rejected without comparing (timingSafeEqual needs
 * equal lengths).
 */
export function verifyRazorpaySubscriptionSignature(
  payloadStr: string,
  signature: string
): boolean {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const env = getServerEnv();
  const secret = env.RAZORPAY_WEBHOOK_SECRET;

  const expected = createHmac("sha256", secret).update(payloadStr).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
