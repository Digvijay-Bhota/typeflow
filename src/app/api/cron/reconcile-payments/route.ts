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
 * - Query, checked after authorization and before any work: none, or exactly
 *   one `dryRun=1` (count what a run would find, write nothing) or `dryRun=0`.
 *   Anything else — another value, a repeated `dryRun`, any other key — is 400,
 *   so a mistyped dry run can never become a real run.
 * - GET only (Vercel Cron sends GET). HEAD is explicitly 405: Next.js would
 *   otherwise answer HEAD with the GET handler and run a reconciliation.
 * - Not behind the user rate limiter: it is authenticated, and bounded by the
 *   service's batch limit and time budget.
 * - Responds with counts only: no provider payloads, no customer data.
 */
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { cronSecretConfigured, isCronAuthorized } from "@/server/lib/cronAuth";
import {
  reconcileModeFromEnv,
  reconcilePayments,
} from "@/server/services/payment.reconciliation.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The only accepted queries: none, `dryRun=1` or `dryRun=0` (compared after
 * URL decoding). Returns the dryRun flag, or null for anything else.
 */
function parseDryRun(searchParams: URLSearchParams): boolean | null {
  const entries = [...searchParams];
  if (entries.length === 0) return false;
  if (entries.length !== 1) return null;
  const [key, value] = entries[0]!;
  if (key !== "dryRun") return null;
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

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
        route: "/api/cron/reconcile-payments",
      });
      return json(
        { error: { code: "CRON_NOT_CONFIGURED", message: "Not available." } },
        503
      );
    }
    if (!isCronAuthorized(req.headers.get("authorization"), secret)) {
      logger.warn("Cron request refused: invalid authorization", {
        route: "/api/cron/reconcile-payments",
      });
      return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, 401);
    }

    const dryRun = parseDryRun(new URL(req.url).searchParams);
    if (dryRun === null) {
      logger.warn("Cron request refused: invalid query", {
        route: "/api/cron/reconcile-payments",
      });
      return json(
        { error: { code: "INVALID_QUERY", message: "Invalid query parameters." } },
        400
      );
    }

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
