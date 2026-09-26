/**
 * GET /api/health
 *
 * Health check endpoint for load balancers and uptime monitors.
 * Returns database and Redis connectivity status.
 *
 * - HTTP 503 only when the database is unreachable (unchanged).
 * - Redis unreachable: HTTP 200 with status "degraded" and redis
 *   "unavailable". Rate-limited endpoints fail closed (429) while Redis is
 *   down, so this is reported, but it does not mark the whole app down.
 * - Both checks run concurrently; the Redis check is bounded by the Redis
 *   client's command timeout.
 *
 * Does NOT expose sensitive configuration or error details.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { checkRedisHealth } from "@/server/lib/redis";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function checkDatabase(): Promise<boolean> {
  try {
    // Simple query to verify DB connectivity
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    logger.error("Health check failed", err, { check: "db" });
    return false;
  }
}

export async function GET() {
  const start = Date.now();

  const [dbOk, redis] = await Promise.all([checkDatabase(), checkRedisHealth()]);

  if (redis.status === "unavailable") {
    logger.warn("Health check: Redis unavailable", {
      check: "redis",
      latencyMs: redis.latencyMs,
      error: redis.error,
    });
  }

  const redisOk = redis.status !== "unavailable";
  const body = {
    status: dbOk && redisOk ? "ok" : "degraded",
    db: dbOk ? "connected" : "disconnected",
    redis: redis.status,
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - start,
  };

  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
