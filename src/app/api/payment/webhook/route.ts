import { NextRequest, NextResponse } from "next/server";
import { processRazorpayWebhook } from "@/server/services/payment.service";
import {
  isWellFormedRazorpaySignature,
  verifyRazorpaySignature,
  wellFormedRazorpayEventId,
} from "@/server/services/razorpay.service";
import { isServiceError } from "@/server/errors";
import { logger } from "@/lib/logger";

type Rejection = "missing_signature" | "malformed_signature" | "invalid_signature";

function signatureRejection(
  signature: string,
  payloadRawString: string
): Rejection | null {
  if (!signature) return "missing_signature";
  if (!isWellFormedRazorpaySignature(signature)) return "malformed_signature";
  if (!verifyRazorpaySignature(payloadRawString, signature)) return "invalid_signature";
  return null;
}

/**
 * Response policy (Razorpay retries any non-2xx delivery):
 *  - 401: missing or wrong signature. Kept non-2xx so that genuine deliveries
 *    signed with a secret we have misconfigured are redelivered once fixed.
 *  - 400: a correctly signed body that is not JSON (Razorpay never sends one).
 *  - 503: fulfillment failed after the payment was recorded; the redelivery
 *    retries it.
 *  - 500: anything unexpected (e.g. the database); transient, so retried.
 *  - 200: processed, a duplicate, an order that is not ours, or an
 *    amount/currency mismatch recorded as an anomaly (retrying cannot fix it).
 *
 * The signature is checked on the raw body before anything parses it.
 * Rejections are logged with a reason only: never the body, the signature or
 * the secret.
 */
export async function POST(req: NextRequest) {
  const eventId = req.headers.get("x-razorpay-event-id");
  try {
    const signature = req.headers.get("x-razorpay-signature") ?? "";
    const payloadRawString = await req.text();

    const rejection = signatureRejection(signature, payloadRawString);
    if (rejection) {
      logger.warn("Razorpay payment webhook rejected", {
        reason: rejection,
        eventId: wellFormedRazorpayEventId(eventId),
        bodyBytes: Buffer.byteLength(payloadRawString),
      });
      return rejection === "missing_signature"
        ? NextResponse.json(
            { error: { code: "UNAUTHORIZED", message: "Missing signature" } },
            { status: 401 }
          )
        : NextResponse.json(
            {
              error: { code: "INVALID_PAYMENT_SIGNATURE", message: "Invalid signature" },
            },
            { status: 401 }
          );
    }

    let payload;
    try {
      payload = JSON.parse(payloadRawString);
    } catch {
      logger.warn("Razorpay payment webhook rejected", {
        reason: "invalid_json",
        eventId: wellFormedRazorpayEventId(eventId),
        bodyBytes: Buffer.byteLength(payloadRawString),
      });
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid JSON" } },
        { status: 400 }
      );
    }

    // The service verifies the signature again before any database access.
    await processRazorpayWebhook(payload, signature, payloadRawString, eventId);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message === "INVALID_PAYMENT_SIGNATURE") {
      logger.warn("Razorpay payment webhook rejected", {
        reason: "invalid_signature",
        eventId: wellFormedRazorpayEventId(eventId),
      });
      return NextResponse.json(
        { error: { code: "INVALID_PAYMENT_SIGNATURE", message: "Invalid signature" } },
        { status: 401 }
      );
    }

    // Recorded as an anomaly by the service, which acknowledges it; kept as a
    // guard should a mismatch ever surface from elsewhere.
    if (err.message === "PAYMENT_AMOUNT_MISMATCH") {
      logger.error("Razorpay payment webhook amount mismatch", undefined, {
        eventId: wellFormedRazorpayEventId(eventId),
      });
      return NextResponse.json(
        { error: { code: "PAYMENT_AMOUNT_MISMATCH", message: "Amount mismatch" } },
        { status: 400 }
      );
    }

    // e.g. FULFILLMENT_FAILED (503): the payment is recorded, but a non-2xx
    // makes Razorpay redeliver so certificate fulfillment is retried.
    if (isServiceError(error)) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }

    logger.error("Razorpay payment webhook processing failed", error, {
      eventId: wellFormedRazorpayEventId(eventId),
    });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to process webhook" } },
      { status: 500 }
    );
  }
}
