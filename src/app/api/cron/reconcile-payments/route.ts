/**
 * GET /api/cron/reconcile-payments
 *
 * Runs one bounded payment reconciliation pass (see
 * payment.reconciliation.service.ts) in the mode set by
 * PAYMENT_RECONCILE_MODE ("off" by default: nothing happens).
 *
 * - Authorization: `Bearer <CRON_SECRET>` (what Vercel Cron sends), compared
 *   in constant time. CRON_SECRET unset or shorter than 32 characters → 503;
 *   missing or wrong token → 401.
 * - `?dryRun=1` counts what a run would find and writes nothing.
 * - Not behind the user rate limiter: it is authenticated, and bounded by the
 *   service's batch limit and time budget.
 * - Responds with counts only: no provider payloads, no customer data.
 */
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  reconcileModeFromEnv,
  reconcilePayments,
} from "@/server/services/payment.reconciliation.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_SECRET_LENGTH = 32;

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time: both sides are hashed to the same length first. */
function isAuthorized(header: string | null, secret: string): boolean {
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: Request) {
  try {
    const secret = getServerEnv().CRON_SECRET;
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      logger.warn("Cron request refused: CRON_SECRET is not configured", {
        route: "/api/cron/reconcile-payments",
      });
      return json(
        { error: { code: "CRON_NOT_CONFIGURED", message: "Not available." } },
        503
      );
    }
    if (!isAuthorized(req.headers.get("authorization"), secret)) {
      logger.warn("Cron request refused: invalid authorization", {
        route: "/api/cron/reconcile-payments",
      });
      return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, 401);
    }

    const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
    const summary = await reconcilePayments({ mode: reconcileModeFromEnv(), dryRun });
    return json(summary, 200);
  } catch (error) {
    logger.error(
      "Payment reconciliation run failed",
      error instanceof Error ? error : undefined,
      { route: "/api/cron/reconcile-payments" }
    );
    return json(
      { error: { code: "INTERNAL_ERROR", message: "Reconciliation failed." } },
      500
    );
  }
}
