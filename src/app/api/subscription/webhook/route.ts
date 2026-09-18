/**
 * POST /api/subscription/webhook
 *
 * Handles Razorpay subscription webhook events.
 *
 * SEPARATE from /api/payment/webhook (certificate one-time payments).
 *
 * Security:
 * - Reads raw body before parsing (signature verification requires raw body)
 * - Verifies HMAC-SHA256 signature using RAZORPAY_WEBHOOK_SECRET
 * - Idempotent: duplicate events are silently ignored
 * - Only handles subscription.* event types
 *
 * Note: Razorpay sends webhooks to this endpoint for subscription events.
 * Configure this URL in Razorpay Dashboard → Webhooks.
 * Subscribe to: subscription.authenticated, subscription.activated,
 *   subscription.charged, subscription.halted, subscription.cancelled,
 *   subscription.completed, subscription.pending, subscription.expired
 */
import { NextRequest, NextResponse } from "next/server";
import { processSubscriptionWebhook } from "@/server/services/subscription.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // 1. Extract signature BEFORE consuming body
    const signature = req.headers.get("x-razorpay-signature");
    if (!signature) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Missing signature" } },
        { status: 401 }
      );
    }

    // 2. Read raw body (required for HMAC verification)
    const payloadRawString = await req.text();

    // 3. Parse JSON
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadRawString) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid JSON" } },
        { status: 400 }
      );
    }

    // 4. Process (signature verified inside service before any DB operations)
    await processSubscriptionWebhook(payload, signature, payloadRawString);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;

    if (err.message === "INVALID_SUBSCRIPTION_SIGNATURE") {
      console.error("Subscription webhook signature mismatch");
      return NextResponse.json(
        {
          error: {
            code: "INVALID_SUBSCRIPTION_SIGNATURE",
            message: "Invalid signature",
          },
        },
        { status: 401 }
      );
    }

    console.error("Subscription webhook processing error:", err);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to process subscription webhook",
        },
      },
      { status: 500 }
    );
  }
}
