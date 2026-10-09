/**
 * GET /api/cron/reconcile-subscriptions
 *
 * Runs one bounded, REPORT-ONLY subscription reconciliation pass (see
 * subscription.reconciliation.service.ts). Unscheduled: it is not in
 * vercel.json, and runs only when called.
 *
 * - Authorization: `Bearer <CRON_SECRET>`, compared in constant time
 *   (src/server/lib/cronAuth.ts). CRON_SECRET unset or shorter than 32
 *   characters → 503; missing or wrong token → 401.
 * - No query parameters are accepted (400): a report run has no options.
 * - Disabled unless SUBSCRIPTION_RECONCILE_MODE is "report": otherwise 503,
 *   without touching the database or Razorpay.
 * - GET only. HEAD is explicitly 405: Next.js would otherwise answer HEAD with
 *   the GET handler and run a reconciliation.
 * - Responds with identifiers, statuses, dates and counts only.
 */
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { cronSecretConfigured, isCronAuthorized } from "@/server/lib/cronAuth";
import {
  reconcileSubscriptions,
  subscriptionReconcileModeFromEnv,
} from "@/server/services/subscription.reconciliation.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ROUTE = "/api/cron/reconcile-subscriptions";

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** HEAD must never run a reconciliation (Next.js would map it to GET). */
export function HEAD() {
  return new Response(null, {
    status: 405,
    headers: { Allow: "GET", "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request) {
  try {
    const secret = getServerEnv().CRON_SECRET;
    if (!cronSecretConfigured(secret)) {
      logger.warn("Cron request refused: CRON_SECRET is not configured", {
        route: ROUTE,
      });
      return json(
        { error: { code: "CRON_NOT_CONFIGURED", message: "Not available." } },
        503
      );
    }
    if (!isCronAuthorized(req.headers.get("authorization"), secret)) {
      logger.warn("Cron request refused: invalid authorization", { route: ROUTE });
      return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, 401);
    }
    if ([...new URL(req.url).searchParams].length > 0) {
      logger.warn("Cron request refused: invalid query", { route: ROUTE });
      return json(
        { error: { code: "INVALID_QUERY", message: "Invalid query parameters." } },
        400
      );
    }

    const mode = subscriptionReconcileModeFromEnv();
    if (mode !== "report") {
      logger.info("Subscription reconciliation is off", { route: ROUTE });
      return json(
        { error: { code: "RECONCILE_DISABLED", message: "Not available." } },
        503
      );
    }

    const summary = await reconcileSubscriptions({ mode });
    return json(summary, 200);
  } catch (error) {
    logger.error(
      "Subscription reconciliation run failed",
      error instanceof Error ? error : undefined,
      { route: ROUTE }
    );
    return json(
      { error: { code: "INTERNAL_ERROR", message: "Reconciliation failed." } },
      500
    );
  }
}
