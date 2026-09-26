import Razorpay from "razorpay";
import { getServerEnv } from "@/lib/env";
import { createHash, createHmac } from "crypto";

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
  const eventId = eventIdHeader?.trim();
  if (eventId && /^[A-Za-z0-9_-]{1,100}$/.test(eventId)) return `evt:${eventId}`;
  return `body:${createHash("sha256").update(payloadRawString).digest("hex")}`;
}

export function verifyRazorpaySignature(payloadStr: string, signature: string): boolean {
  const env = getServerEnv();
  const secret = env.RAZORPAY_WEBHOOK_SECRET;

  const expectedSignature = createHmac("sha256", secret).update(payloadStr).digest("hex");

  return expectedSignature === signature;
}
