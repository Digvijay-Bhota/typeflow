import { Redis } from "ioredis";
import crypto from "crypto";
import { getServerEnv } from "../../lib/env";
import { deploymentEnvironment } from "../../lib/environmentGuard";

const globalForRedis = globalThis as unknown as {
  redisClient: Redis | null | undefined;
};

// With lazyConnect, ioredis starts the first command's timer before the
// connection exists, so on a cold instance commandTimeout must also cover
// DNS + TCP + TLS + AUTH. connectTimeout is longer so a slow handshake can
// still finish in the background for the next request.
export const REDIS_CONNECT_TIMEOUT_MS = 3000;
export const REDIS_COMMAND_TIMEOUT_MS = 2000;

export function getRedisClient(): Redis | null {
  const cached = globalForRedis.redisClient;
  if (cached !== undefined) {
    // retryStrategy gives up after one reconnect, which leaves the client in
    // the terminal "end" state. Replace it instead of failing every request
    // on this instance until it is recycled.
    if (cached === null || cached.status !== "end") {
      return cached;
    }
    globalForRedis.redisClient = undefined;
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
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
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

  // Keys are scoped by environment, so a preview or local run that shares a
  // Redis instance with production can never touch production's counters.
  // Tests keep their own isolation: a per-run TEST_RL_PREFIX, else the
  // unscoped key.
  const environment = deploymentEnvironment(process.env);
  if (environment === "test") {
    const testPrefix = process.env.TEST_RL_PREFIX;
    return testPrefix ? `${testPrefix}:${hash}` : `rl:v1:${hash}`;
  }
  return `rl:v1:${environment}:${hash}`;
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
