/**
 * Prisma client singleton for server-side use.
 *
 * In development, reuses the same instance across hot reloads
 * (prevents "too many connections" errors).
 *
 * NEVER import this in client-side code.
 * This module is server-only.
 */
import { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let connectionUrl = process.env.DATABASE_URL;

// Enforce production serverless connection pooling limits
if (process.env.VERCEL && connectionUrl) {
  try {
    const url = new URL(connectionUrl);
    // Vercel serverless functions independently scale and can exhaust connections.
    // Ensure we limit each instance to 1 connection and flag PgBouncer mode.
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "1");
    }
    if (!url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }
    connectionUrl = url.toString();
  } catch {
    // Fallback to unmodified URL if parsing fails
  }
}

export const db: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(connectionUrl && { datasources: { db: { url: connectionUrl } } }),
    log:
      process.env.NODE_ENV === "development"
        ? [
            { emit: "event", level: "query" },
            { emit: "event", level: "warn" },
            { emit: "event", level: "error" },
          ]
        : [
            { emit: "event", level: "warn" },
            { emit: "event", level: "error" },
          ],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;

  // Log queries in development (helps identify N+1s)
  db.$on("query" as never, (e: { query: string; duration: number }) => {
    if (e.duration > 100) {
      logger.warn("Slow query detected", {
        query: e.query.slice(0, 200),
        durationMs: e.duration,
      });
    }
  });

  db.$on("warn" as never, (e: { message: string }) => {
    logger.warn("Prisma warning", { message: e.message });
  });

  db.$on("error" as never, (e: { message: string }) => {
    logger.error("Prisma error", new Error(e.message));
  });
}
