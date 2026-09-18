/**
 * GET /api/subscription/status
 *
 * Returns the authenticated user's current subscription status and entitlement.
 *
 * Security:
 * - Requires authentication
 * - Returns user-specific data only
 * - No shared caching (user-specific entitlement must not leak between users)
 */
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { getUserBillingInfo } from "@/server/services/subscription.service";
import { rateLimit } from "@/server/middleware/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`sub_status_${ip}`, 30, 60000);
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

    const billing = await getUserBillingInfo(user.id);

    return NextResponse.json({
      plan: billing.plan,
      status: billing.status,
      isPro: billing.isPro,
      currentPeriodEnd: billing.currentPeriodEnd?.toISOString() ?? null,
      cancelAt: billing.cancelAt?.toISOString() ?? null,
      cancelledAt: billing.cancelledAt?.toISOString() ?? null,
    });
  } catch (error: unknown) {
    console.error("Subscription status error:", error);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to fetch subscription status",
        },
      },
      { status: 500 }
    );
  }
}
