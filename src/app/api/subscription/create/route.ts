/**
 * POST /api/subscription/create
 *
 * Creates a new Pro subscription for the authenticated user.
 *
 * Security:
 * - Requires authentication (userId from server-side auth, never from client)
 * - interval validated against server allowlist
 * - plan/price determined server-side — NEVER trusted from client
 * - returns only client-safe checkout identifiers (no secrets)
 *
 * Request body:
 *   { interval: "monthly" | "yearly" }
 *
 * Response:
 *   { subscriptionId, providerSubscriptionId, shortUrl, plan, interval }
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedUser } from "@/server/services/auth.service";
import { createProSubscription } from "@/server/services/subscription.service";
import { SUBSCRIPTION_INTERVALS } from "@/lib/constants";

import { rateLimit } from "@/server/middleware/rateLimit";

export const dynamic = "force-dynamic";

const CreateSubscriptionSchema = z.object({
  interval: z.enum(SUBSCRIPTION_INTERVALS),
});

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`sub_create_${ip}`, 10, 60000);
    if (!success) {
      return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
    }

    // 1. Require authentication — userId is from server-side auth
    const user = await requireAuthenticatedUser();

    // 2. Validate request body (only interval — never trust amount/plan/userId from client)
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid JSON" } },
        { status: 400 }
      );
    }

    const parsed = CreateSubscriptionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request: interval must be 'monthly' or 'yearly'",
          },
        },
        { status: 400 }
      );
    }

    const { interval } = parsed.data;

    // 3. Create subscription (server controls plan/price)
    const result = await createProSubscription(user.id, interval);

    // 4. Return only client-safe data (no secrets, no internal IDs that could be spoofed)
    return NextResponse.json({
      subscriptionId: result.subscriptionId,
      providerSubscriptionId: result.providerSubscriptionId,
      shortUrl: result.shortUrl,
      plan: result.plan,
      interval: result.interval,
    });
  } catch (error: unknown) {
    const err = error as Error;

    if (err.message === "Unauthorized") {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 }
      );
    }

    if (err.message === "SUBSCRIPTION_ALREADY_ACTIVE") {
      return NextResponse.json(
        {
          error: {
            code: "SUBSCRIPTION_ALREADY_ACTIVE",
            message: "You already have an active Pro subscription",
          },
        },
        { status: 409 }
      );
    }

    if (
      err.message.includes("RAZORPAY_PLAN_ID_PRO") &&
      err.message.includes("is not configured")
    ) {
      return NextResponse.json(
        {
          error: {
            code: "SUBSCRIPTION_NOT_CONFIGURED",
            message:
              "Subscription service is not currently available. Please contact support.",
          },
        },
        { status: 503 }
      );
    }

    console.error("Subscription create error:", err);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to create subscription",
        },
      },
      { status: 500 }
    );
  }
}
