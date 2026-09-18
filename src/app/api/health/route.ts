/**
 * GET /api/health
 *
 * Health check endpoint for load balancers and uptime monitors.
 * Returns database connectivity status.
 *
 * Does NOT expose sensitive configuration.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const start = Date.now();

  try {
    // Simple query to verify DB connectivity
    await db.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "ok",
        db: "connected",
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - start,
      },
      { status: 200 }
    );
  } catch (err) {
    logger.error("Health check failed", err);

    return NextResponse.json(
      {
        status: "degraded",
        db: "disconnected",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
