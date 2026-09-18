import { NextRequest, NextResponse } from "next/server";
import { processRazorpayWebhook } from "@/server/services/payment.service";

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("x-razorpay-signature");
    if (!signature) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Missing signature" } },
        { status: 401 }
      );
    }

    const payloadRawString = await req.text();
    let payload;
    try {
      payload = JSON.parse(payloadRawString);
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid JSON" } },
        { status: 400 }
      );
    }

    await processRazorpayWebhook(payload, signature, payloadRawString);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message === "INVALID_PAYMENT_SIGNATURE") {
      console.error("Razorpay webhook signature mismatch");
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

    console.error("Webhook processing error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to process webhook" } },
      { status: 500 }
    );
  }
}
