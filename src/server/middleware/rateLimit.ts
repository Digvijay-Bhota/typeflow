import { getRedisClient, executeRateLimitScript } from '../lib/redis';

const rateLimitCache = new Map<string, { count: number; resetAt: number }>();
let isCleanupRunning = false;

export async function rateLimit(
  identifier: string,
  limit: number = 10,
  windowMs: number = 60000
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const env = process.env.NODE_ENV || "development";
  const now = Date.now();

  try {
    const redisClient = getRedisClient();
    
    if (redisClient) {
      const result = await executeRateLimitScript(redisClient, identifier, limit, windowMs);
      
      if (result) {
        const resetAt = now + Math.max(0, result.ttl);
        if (result.allowed) {
          return {
            success: true,
            limit,
            remaining: Math.max(0, limit - result.count),
            reset: resetAt
          };
        } else {
          return {
            success: false,
            limit,
            remaining: 0,
            reset: resetAt
          };
        }
      } else {
        return failClosed(limit, now + windowMs);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Configuration Error')) {
      throw err;
    }
    return failClosed(limit, now + windowMs);
  }

  if (env === 'production') {
    throw new Error("Configuration Error: Memory fallback used in production.");
  }

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

function failClosed(limit: number, resetAt: number) {
  return {
    success: false,
    limit,
    remaining: 0,
    reset: resetAt
  };
}

function startCleanupIfNecessary() {
  if (isCleanupRunning) return;
  if (typeof setInterval !== "undefined") {
    isCleanupRunning = true;
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of rateLimitCache.entries()) {
        if (now > value.resetAt) {
          rateLimitCache.delete(key);
        }
      }
    }, 60000);
    if (interval.unref) interval.unref();
  }
}
