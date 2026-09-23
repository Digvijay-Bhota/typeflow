import { Redis } from "ioredis";
import crypto from "crypto";
import { getServerEnv } from "../../lib/env";

const globalForRedis = globalThis as unknown as {
  redisClient: Redis | null | undefined;
};

export function getRedisClient(): Redis | null {
  if (globalForRedis.redisClient !== undefined) {
    return globalForRedis.redisClient;
  }

  const envConfig = getServerEnv();
  const env = envConfig.NODE_ENV;
  let redisUrl = envConfig.REDIS_URL;

  if (env === "test" && envConfig.TEST_REDIS_URL) {
    redisUrl = envConfig.TEST_REDIS_URL;
  }

  if (!redisUrl) {
    globalForRedis.redisClient = null;
    return null;
  }

  const options: any = {
    lazyConnect: true,
    connectTimeout: 1000,
    commandTimeout: 500,
    maxRetriesPerRequest: 1,
    retryStrategy(times: number) {
      if (times > 1) {
        return null;
      }
      return 100;
    },
    reconnectOnError(err: Error) {
      if (err.message.includes("READONLY")) {
        return true;
      }
      return false;
    },
  };

  const client = new Redis(redisUrl, options);

  client.on("error", (err) => {
    // Only log standard properties to prevent leaking secrets in URL
    console.error(`[Redis Error] ${err.name}: ${err.message}`);
  });

  globalForRedis.redisClient = client;
  return client;
}

export function generateRateLimitKey(identifier: string): string {
  const hash = crypto.createHash("sha256").update(identifier).digest("hex");

  // Safe default prefix in case of early import outside server context,
  // though realistically rateLimit runs in server context.
  let env = process.env.NODE_ENV;
  const testPrefix = process.env.TEST_RL_PREFIX;

  try {
    const envConfig = getServerEnv();
    env = envConfig.NODE_ENV;
  } catch {
    // If getServerEnv throws (e.g., config error), fallback to process.env
  }

  if (env === "test" && testPrefix) {
    return `${testPrefix}:${hash}`;
  }
  return `rl:v1:${hash}`;
}

const rateLimitLuaScript = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])

local count = redis.call('GET', key)

if count == false then
    redis.call('SET', key, 1, 'PX', windowMs)
    return { 1, 1, windowMs }
end

count = tonumber(count)
local ttl = redis.call('PTTL', key)

if ttl == -1 then
    redis.call('SET', key, 1, 'PX', windowMs)
    return { 1, 1, windowMs }
end

if count >= limit then
    return { 0, count, ttl }
end

local new_count = redis.call('INCR', key)
return { 1, new_count, ttl }
`;

export async function executeRateLimitScript(
  client: Redis,
  identifier: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; count: number; ttl: number } | null> {
  const key = generateRateLimitKey(identifier);

  try {
    const result = (await client.eval(rateLimitLuaScript, 1, key, limit, windowMs)) as [
      number,
      number,
      number,
    ];

    if (result && Array.isArray(result) && result.length === 3) {
      return {
        allowed: result[0] === 1,
        count: result[1],
        ttl: result[2],
      };
    }
    return null;
  } catch (error) {
    if (error instanceof Error) {
      console.error(`[Redis Rate Limit Script Error] ${error.name}: ${error.message}`);
    }
    return null;
  }
}
