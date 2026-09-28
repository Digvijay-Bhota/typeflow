/**
 * POST /api/cron/repair-certificate-qr — one-off repair of TF-2026-C9XGPR's
 * QR code (Phase 6, F1; see certificateQrRepair.service.ts). Temporary: removed
 * after the Production run. Not scheduled.
 *
 * - Authorization: `Bearer <CRON_SECRET>`, compared in constant time.
 *   CRON_SECRET unset or shorter than 32 characters → 503; missing or wrong
 *   token → 401.
 * - Query: exactly one `dryRun=1` (check and render, write nothing) or
 *   `dryRun=0` (apply). Anything else, including no query, is 400: this route
 *   never changes anything without an explicit dryRun=0.
 * - POST only; every other method is 405.
 * - 200: dry_run, repaired, already_repaired. 409: a precondition failed
 *   (nothing written). 500: the repair failed (`pdfRestored` says what
 *   happened to the PDF). Responses carry hashes, sizes and the public URL
 *   only.
 */
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  QrRepairError,
  repairCertificateQr,
} from "@/server/services/certificateQrRepair.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN_SECRET_LENGTH = 32;

const digest = (value: string) => createHash("sha256").update(value).digest();

function isAuthorized(header: string | null, secret: string): boolean {
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Exactly one dryRun=1 or dryRun=0; null for anything else (including none). */
function parseDryRun(searchParams: URLSearchParams): boolean | null {
  const entries = [...searchParams];
  if (entries.length !== 1) return null;
  const [key, value] = entries[0]!;
  if (key !== "dryRun") return null;
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

export async function POST(req: Request) {
  const route = "/api/cron/repair-certificate-qr";
  try {
    const secret = getServerEnv().CRON_SECRET;
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      logger.warn("Repair request refused: CRON_SECRET is not configured", { route });
      return json({ error: { code: "NOT_CONFIGURED", message: "Not available." } }, 503);
    }
    if (!isAuthorized(req.headers.get("authorization"), secret)) {
      logger.warn("Repair request refused: invalid authorization", { route });
      return json({ error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, 401);
    }
    const dryRun = parseDryRun(new URL(req.url).searchParams);
    if (dryRun === null) {
      logger.warn("Repair request refused: invalid query", { route });
      return json(
        {
          error: {
            code: "INVALID_QUERY",
            message: "Exactly one dryRun=1 or dryRun=0 is required.",
          },
        },
        400
      );
    }

    const result = await repairCertificateQr({ dryRun });
    return json(result, result.outcome === "precondition_failed" ? 409 : 200);
  } catch (error) {
    const pdfRestored = error instanceof QrRepairError ? error.pdfRestored : null;
    logger.error(
      "Certificate QR repair request failed",
      error instanceof Error ? error : undefined,
      { route, pdfRestored }
    );
    return json(
      { error: { code: "REPAIR_FAILED", message: "Repair failed." }, pdfRestored },
      500
    );
  }
}
