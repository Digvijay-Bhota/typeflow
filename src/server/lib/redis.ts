import { Redis } from 'ioredis';
import crypto from 'crypto';

const globalForRedis = globalThis as unknown as {
  redisClient: Redis | null | undefined;
};

export function getRedisClient(): Redis | null {
  if (globalForRedis.redisClient !== undefined) {
    return globalForRedis.redisClient;
  }

  const env = process.env.NODE_ENV || 'development';
  let redisUrl = process.env.REDIS_URL;

  if (env === 'test' && process.env.TEST_REDIS_URL) {
    redisUrl = process.env.TEST_REDIS_URL;
  }

  if (!redisUrl) {
    if (env === 'production') {
      throw new Error("Configuration Error: REDIS_URL is missing in production.");
    }
    globalForRedis.redisClient = null;
    return null;
  }

  if (env === 'production' && !redisUrl.startsWith('rediss://')) {
    throw new Error("Configuration Error: Production REDIS_URL must use rediss://");
  }

  const options: any = {
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 3000,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 3) {
        return null;
      }
      return Math.min(times * 100, 1000);
    },
    reconnectOnError(err: Error) {
      if (err.message.includes('READONLY')) {
        return true;
      }
      return false;
    }
  };

  const client = new Redis(redisUrl, options);
  
  client.on('error', (err) => {
    // Only log standard properties to prevent leaking secrets in URL
    console.error(`[Redis Error] ${err.name}: ${err.message}`);
  });

  globalForRedis.redisClient = client;
  return client;
}

export function generateRateLimitKey(identifier: string): string {
  const hash = crypto.createHash('sha256').update(identifier).digest('hex');
  const env = process.env.NODE_ENV;
  if (env === 'test' && process.env.TEST_RL_PREFIX) {
    return `${process.env.TEST_RL_PREFIX}:${hash}`;
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

if count >= limit then
    if ttl == -1 then
        redis.call('PEXPIRE', key, windowMs)
        ttl = windowMs
    end
    return { 0, count, ttl }
end

local new_count = redis.call('INCR', key)
if ttl == -1 then
    redis.call('PEXPIRE', key, windowMs)
    ttl = windowMs
end
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
    const result = await client.eval(
      rateLimitLuaScript,
      1,
      key,
      limit,
      windowMs
    ) as [number, number, number];
    
    if (result && Array.isArray(result) && result.length === 3) {
      return {
        allowed: result[0] === 1,
        count: result[1],
        ttl: result[2]
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
