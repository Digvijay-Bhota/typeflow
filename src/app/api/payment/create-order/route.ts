import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { createCertificateOrder } from "@/server/services/payment.service";

import { rateLimit } from "@/server/middleware/rateLimit";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`payment_order_${ip}`, 10, 60000);
    if (!success) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { certificateId } = body;

    if (!certificateId) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Missing certificateId" } },
        { status: 400 }
      );
    }

    const orderData = await createCertificateOrder(certificateId, user.id);

    // Add public key id from client env (or server env but it's safe to expose for checkout)
    const { getClientEnv } = await import("@/lib/env");
    const clientEnv = getClientEnv();

    return NextResponse.json({
      orderId: orderData.orderId,
      amount: orderData.amount,
      currency: orderData.currency,
      keyId: clientEnv.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (error: unknown) {
    const err = error as Error;
    if (
      err.message === "Unauthorized" ||
      err.message.includes("Cannot create order for certificate")
    ) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: err.message } },
        { status: 403 }
      );
    }

    if (
      (err as { code?: string }).code === "P2025" ||
      err.message.includes("No Certificate found")
    ) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Certificate not found" } },
        { status: 404 }
      );
    }

    console.error("Create order error:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create order" } },
      { status: 500 }
    );
  }
}
