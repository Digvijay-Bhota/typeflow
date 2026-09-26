import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { retryCertificateFulfillment } from "@/server/services/certificate.service";
import { rateLimit } from "@/server/middleware/rateLimit";
import { isServiceError } from "@/server/errors";

const FulfillSchema = z.object({ certificateId: z.string().min(1).max(40) });

/**
 * Owner-only retry of a paid certificate's PDF/QR fulfillment. It can only
 * complete an already-paid certificate: it never charges, creates or reactivates.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`certificate_fulfill_${ip}`, 5, 60000);
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

    const parsed = FulfillSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "A valid certificateId is required" } },
        { status: 400 }
      );
    }

    const { status } = await retryCertificateFulfillment(
      user.id,
      parsed.data.certificateId
    );
    return NextResponse.json({ status });
  } catch (error: unknown) {
    if (isServiceError(error)) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }
    console.error("Certificate fulfillment error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to prepare certificate" } },
      { status: 500 }
    );
  }
}
