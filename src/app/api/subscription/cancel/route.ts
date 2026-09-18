/**
 * POST /api/subscription/cancel
 *
 * Cancels the authenticated user's Pro subscription at end of current period.
 *
 * Security:
 * - Requires authentication
 * - userId from server-side auth only
 * - No client-supplied subscription ID (cannot spoof another user's subscription)
 *
 * The user retains Pro access until currentPeriodEnd.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/server/services/auth.service";
import { cancelProSubscription } from "@/server/services/subscription.service";
import { rateLimit } from "@/server/middleware/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`sub_cancel_${ip}`, 10, 60000);
    if (!success) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const user = await requireAuthenticatedUser();

    await cancelProSubscription(user.id);

    return NextResponse.json({
      success: true,
      message:
        "Subscription cancelled. You will retain Pro access until the end of your current billing period.",
    });
  } catch (error: unknown) {
    const err = error as Error;

    if (err.message === "Unauthorized") {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 }
      );
    }

    if (err.message === "SUBSCRIPTION_NOT_FOUND") {
      return NextResponse.json(
        {
          error: {
            code: "SUBSCRIPTION_NOT_FOUND",
            message: "No subscription found",
          },
        },
        { status: 404 }
      );
    }

    if (err.message === "SUBSCRIPTION_ALREADY_CANCELLED") {
      return NextResponse.json(
        {
          error: {
            code: "SUBSCRIPTION_ALREADY_CANCELLED",
            message: "Subscription is already cancelled",
          },
        },
        { status: 409 }
      );
    }

    console.error("Subscription cancel error:", err);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to cancel subscription",
        },
      },
      { status: 500 }
    );
  }
}
