import Razorpay from "razorpay";
import { getServerEnv } from "@/lib/env";
import { createHash, createHmac, timingSafeEqual } from "crypto";

let razorpayClient: Razorpay | undefined;

function getRazorpayClient() {
  if (!razorpayClient) {
    const env = getServerEnv();
    razorpayClient = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayClient;
}

export async function createRazorpayOrder(
  amountPaise: number,
  receiptId: string,
  notes: Record<string, string> = {}
) {
  const rzp = getRazorpayClient();
  const options = {
    amount: amountPaise,
    currency: "INR",
    receipt: receiptId,
    notes,
  };

  const order = await rzp.orders.create(options);
  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    receipt: order.receipt,
  };
}

// ---------------------------------------------------------------------------
// Read-only access (payment reconciliation). Nothing here creates, captures or
// refunds anything; keep mutation calls out of this section.
// ---------------------------------------------------------------------------

/** The fields of a Razorpay payment that reconciliation reads. */
export type RazorpayPaymentSnapshot = {
  id: string;
  orderId: string | null;
  /** created | authorized | captured | refunded | failed */
  status: string;
  /** Smallest currency unit (paise). */
  amount: number;
  currency: string;
  captured: boolean;
  amountRefunded: number;
  /** "partial" | "full" | null */
  refundStatus: string | null;
};

function toSnapshot(p: Record<string, unknown>): RazorpayPaymentSnapshot {
  const refundStatus = typeof p.refund_status === "string" ? p.refund_status : null;
  return {
    id: String(p.id),
    orderId: typeof p.order_id === "string" ? p.order_id : null,
    status: String(p.status),
    amount: Number(p.amount),
    currency: String(p.currency),
    captured: p.captured === true,
    amountRefunded: Number(p.amount_refunded ?? 0),
    refundStatus: refundStatus === "null" ? null : refundStatus,
  };
}

/** GET /v1/orders/:id/payments — every payment attempt on an order. */
export async function fetchRazorpayOrderPayments(
  orderId: string
): Promise<RazorpayPaymentSnapshot[]> {
  const { items } = await getRazorpayClient().orders.fetchPayments(orderId);
  return items.map((item) => toSnapshot(item as unknown as Record<string, unknown>));
}

/** GET /v1/payments/:id */
export async function fetchRazorpayPayment(
  paymentId: string
): Promise<RazorpayPaymentSnapshot> {
  const payment = await getRazorpayClient().payments.fetch(paymentId);
  return toSnapshot(payment as unknown as Record<string, unknown>);
}

/** The fields of a Razorpay refund that reconciliation reads. */
export type RazorpayRefundSnapshot = {
  id: string;
  paymentId: string | null;
  /** pending | processed | failed */
  status: string;
  /** Smallest currency unit (paise). */
  amount: number;
  currency: string;
};

function toRefundSnapshot(r: Record<string, unknown>): RazorpayRefundSnapshot {
  return {
    id: String(r.id),
    paymentId: typeof r.payment_id === "string" ? r.payment_id : null,
    status: String(r.status),
    amount: Number(r.amount),
    currency: String(r.currency),
  };
}

const REFUND_PAGE_SIZE = 100; // Razorpay's maximum
const REFUND_MAX_PAGES = 10;

/**
 * GET /v1/payments/:id/refunds — every refund of a payment, all pages.
 * Throws rather than return a partial list.
 */
export async function fetchRazorpayPaymentRefunds(
  paymentId: string
): Promise<RazorpayRefundSnapshot[]> {
  const refunds: RazorpayRefundSnapshot[] = [];
  for (let page = 0; page < REFUND_MAX_PAGES; page++) {
    const { items } = await getRazorpayClient().payments.fetchMultipleRefund(paymentId, {
      count: REFUND_PAGE_SIZE,
      skip: page * REFUND_PAGE_SIZE,
    });
    refunds.push(
      ...items.map((item) => toRefundSnapshot(item as unknown as Record<string, unknown>))
    );
    if (items.length < REFUND_PAGE_SIZE) return refunds;
  }
  throw new Error("Too many refunds to list for one payment");
}

/**
 * Stable idempotency key for a Razorpay webhook delivery.
 *
 * Razorpay sends `x-razorpay-event-id`, which is unique per event and is the
 * documented way to detect duplicate deliveries. When it is absent, fall back
 * to a hash of the signed raw body: byte-identical redeliveries collapse, and
 * distinct events never do. Never time-based.
 */
export function razorpayEventKey(
  eventIdHeader: string | null | undefined,
  payloadRawString: string
): string {
  // The header is not covered by the HMAC, so only accept a well-formed id.
  // State transitions stay guarded by payment/subscription status regardless.
  const eventId = wellFormedRazorpayEventId(eventIdHeader);
  if (eventId) return `evt:${eventId}`;
  return `body:${createHash("sha256").update(payloadRawString).digest("hex")}`;
}

/** The `x-razorpay-event-id` header if it is a well-formed id, else undefined. */
export function wellFormedRazorpayEventId(
  eventIdHeader: string | null | undefined
): string | undefined {
  const eventId = eventIdHeader?.trim();
  return eventId && /^[A-Za-z0-9_-]{1,100}$/.test(eventId) ? eventId : undefined;
}

/** An HMAC-SHA256 hex digest, as Razorpay sends it (and `digest("hex")` produces). */
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

/** Whether `signature` has the shape of a Razorpay webhook signature at all. */
export function isWellFormedRazorpaySignature(signature: string): boolean {
  return SIGNATURE_PATTERN.test(signature);
}

/**
 * HMAC-SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET, compared in
 * constant time. Accepts exactly the lowercase hex digest; anything malformed
 * is rejected without comparing (timingSafeEqual needs equal lengths).
 */
export function verifyRazorpaySignature(payloadStr: string, signature: string): boolean {
  if (!isWellFormedRazorpaySignature(signature)) return false;
  const env = getServerEnv();
  const secret = env.RAZORPAY_WEBHOOK_SECRET;

  const expected = createHmac("sha256", secret).update(payloadStr).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
