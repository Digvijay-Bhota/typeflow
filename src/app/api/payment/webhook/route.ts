import { NextRequest, NextResponse } from "next/server";
import { processRazorpayWebhook } from "@/server/services/payment.service";
import { isServiceError } from "@/server/errors";
import { logSignatureMismatchDiagnostics } from "@/server/services/razorpayWebhookDiagnostics";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-razorpay-signature");
  let payloadRawString: string | undefined;
  try {
    if (!signature) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Missing signature" } },
        { status: 401 }
      );
    }

    payloadRawString = await req.text();
    let payload;
    try {
      payload = JSON.parse(payloadRawString);
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid JSON" } },
        { status: 400 }
      );
    }

    await processRazorpayWebhook(
      payload,
      signature,
      payloadRawString,
      req.headers.get("x-razorpay-event-id")
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message === "INVALID_PAYMENT_SIGNATURE") {
      console.error("Razorpay webhook signature mismatch");
      // TEMPORARY Phase 5B diagnostics; the webhook is still rejected below.
      if (signature && payloadRawString !== undefined) {
        logSignatureMismatchDiagnostics(payloadRawString, signature, req.headers);
      }
      return NextResponse.json(
        { error: { code: "INVALID_PAYMENT_SIGNATURE", message: "Invalid signature" } },
        { status: 401 }
      );
    }

    if (err.message === "PAYMENT_AMOUNT_MISMATCH") {
      console.error("Razorpay webhook amount mismatch");
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

    console.error("Webhook processing error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to process webhook" } },
      { status: 500 }
    );
  }
}
