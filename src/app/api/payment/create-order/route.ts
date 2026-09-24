import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { createCertificateOrder } from "@/server/services/payment.service";

import { rateLimit } from "@/server/middleware/rateLimit";
import { isServiceError } from "@/server/errors";
import { z } from "zod";

const CreateOrderSchema = z.object({ certificateId: z.string().min(1).max(40) });

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

    const parsed = CreateOrderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "A valid certificateId is required" } },
        { status: 400 }
      );
    }

    const orderData = await createCertificateOrder(parsed.data.certificateId, user.id);

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
    if (isServiceError(error)) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }

    // Unexpected failure (database or Razorpay): never expose its details.
    console.error("Create order error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create order" } },
      { status: 500 }
    );
  }
}
