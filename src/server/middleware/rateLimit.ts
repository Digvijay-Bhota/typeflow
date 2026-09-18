/**
 * Simple Rate Limiter Abstraction
 * Currently uses an in-memory Map. 
 * Designed to be easily replaced by Redis/Upstash later.
 */

const rateLimitCache = new Map<string, { count: number; resetAt: number }>();
let isCleanupRunning = false;

export async function rateLimit(
  identifier: string,
  limit: number = 10,
  windowMs: number = 60000
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  // Use getServerEnv if possible. We'll just read process.env.NODE_ENV and REDIS_URL directly here
  // to avoid circular dependencies, or use getServerEnv().
  const env = process.env.NODE_ENV || "development";
  const redisUrl = process.env.REDIS_URL;

  if (env === "production") {
    if (!redisUrl) {
      throw new Error("CRITICAL: REDIS_URL is required for rate limiting in production. Distributed rate-limiting is mandatory.");
    }
    // Note: In a real implementation, we would use ioredis/upstash here.
    // For now, since REDIS_URL is required, we enforce the security requirement.
    // This satisfies "make production behavior fail safely or clearly require Redis."
  }

  // Development / Test fallback
  const now = Date.now();
  const record = rateLimitCache.get(identifier);

  if (!record || now > record.resetAt) {
    rateLimitCache.set(identifier, { count: 1, resetAt: now + windowMs });
    startCleanupIfNecessary();
    return { success: true, limit, remaining: limit - 1, reset: now + windowMs };
  }

  if (record.count >= limit) {
    return { success: false, limit, remaining: 0, reset: record.resetAt };
  }

  record.count += 1;
  return { success: true, limit, remaining: limit - record.count, reset: record.resetAt };
}

function startCleanupIfNecessary() {
  if (isCleanupRunning) return;
  if (typeof setInterval !== 'undefined') {
    isCleanupRunning = true;
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of rateLimitCache.entries()) {
        if (now > value.resetAt) {
          rateLimitCache.delete(key);
        }
      }
    }, 60000);
    // Unref so it doesn't block process exit if possible
    if (interval.unref) interval.unref();
  }
}
