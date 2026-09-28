/**
 * POST /api/cron/resign-legacy-certificates — ONE-OFF MAINTENANCE (5C-9).
 *
 * Re-signs the six certificates issued before the signing cutover (see
 * certificateResign.service.ts). REMOVE this route once the Production run is
 * done and verified.
 *
 * - Authorization: `Bearer <CRON_SECRET>`, compared in constant time, exactly
 *   as /api/cron/reconcile-payments: CRON_SECRET unset or shorter than 32
 *   characters → 503; missing or wrong token → 401.
 * - Body: `{}` or `{ "mode": "dry-run" | "apply" | "rollback" }`; dry-run
 *   (writes nothing) is the default. Any other field is rejected (400): the
 *   certificates are hard-coded and cannot be chosen by the request.
 * - POST only, so a cron schedule or a crawler can never trigger it.
 * - Responds with counts, certificate ids/statuses/outcomes and safety
 *   checks only: never a hash.
 */
import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { certificateResignRequestSchema } from "@/schemas/certificateResign.schema";
import { resignLegacyCertificates } from "@/server/services/certificateResign.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_SECRET_LENGTH = 32;
const ROUTE = "/api/cron/resign-legacy-certificates";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time: both sides are hashed to the same length first. */
function isAuthorized(header: string | null, secret: string): boolean {
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  try {
    const secret = getServerEnv().CRON_SECRET;
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      logger.warn("Maintenance request refused: CRON_SECRET is not configured", {
        route: ROUTE,
      });
      return json(
        { error: { code: "CRON_NOT_CONFIGURED", message: "Not available." } },
        503
      );
    }
    if (!isAuthorized(req.headers.get("authorization"), secret)) {
      logger.warn("Maintenance request refused: invalid authorization", { route: ROUTE });
      return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, 401);
    }

    const text = await req.text();
    let body: unknown = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    const parsed = certificateResignRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        {
          error: {
            code: "BAD_REQUEST",
            message: 'Body must be {} or { "mode": "dry-run" | "apply" | "rollback" }.',
          },
        },
        400
      );
    }

    return json(await resignLegacyCertificates(parsed.data.mode), 200);
  } catch (error) {
    logger.error("Legacy certificate re-sign failed", error, { route: ROUTE });
    return json({ error: { code: "INTERNAL_ERROR", message: "Re-sign failed." } }, 500);
  }
}
