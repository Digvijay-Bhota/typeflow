import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { rateLimit } from "../../src/server/middleware/rateLimit";
import {
  getRedisClient,
  executeRateLimitScript,
  generateRateLimitKey,
  REDIS_CONNECT_TIMEOUT_MS,
  REDIS_COMMAND_TIMEOUT_MS,
} from "../../src/server/lib/redis";
import Redis from "ioredis";
import { fork } from "child_process";
import path from "path";
import crypto from "crypto";
import net from "net";

// Use a local redis for tests
const TEST_REDIS_URL = process.env.TEST_REDIS_URL || "redis://localhost:6379";

describe("Distributed Rate Limiter", () => {
  let redisClient: Redis;
  let testPrefix: string;

  beforeEach(async () => {
    testPrefix = `rl:test:${crypto.randomBytes(4).toString("hex")}`;
    vi.stubEnv("TEST_RL_PREFIX", testPrefix);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TEST_REDIS_URL", TEST_REDIS_URL);
    vi.stubEnv("SUPABASE_URL", "https://placeholder.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "placeholder");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "placeholder");
    vi.stubEnv("DATABASE_URL", "postgresql://placeholder");
    vi.stubEnv("DIRECT_URL", "postgresql://placeholder");
    vi.stubEnv("RAZORPAY_KEY_ID", "placeholder");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "placeholder");
    vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "placeholder");
    vi.stubEnv("SESSION_SECRET", "12345678901234567890123456789012");
    vi.stubEnv("APP_URL", "http://localhost:3000");

    // Clear _serverEnv cache
    const envModule = await import("../../src/lib/env");
    envModule.__clearServerEnvForTesting();

    // Reset global client if it exists
    const g = globalThis as any;
    if (g.redisClient) {
      g.redisClient.disconnect();
      g.redisClient = undefined;
    }
    redisClient = new Redis(TEST_REDIS_URL);
  });

  afterEach(async () => {
    // Clean up keys for this test prefix
    const keys = await redisClient.keys(`${testPrefix}:*`);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
    redisClient.disconnect();

    const g = globalThis as any;
    if (g.redisClient) {
      g.redisClient.disconnect();
      g.redisClient = undefined;
    }

    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("1. Basic semantics", () => {
    it("handles first request, limits, and rejection", async () => {
      const id = "basic_test_id";

      // First request
      const r1 = await rateLimit(id, 2, 10000);
      expect(r1.success).toBe(true);
      expect(r1.remaining).toBe(1);
      expect(r1.limit).toBe(2);

      // Second request (boundary)
      const r2 = await rateLimit(id, 2, 10000);
      expect(r2.success).toBe(true);
      expect(r2.remaining).toBe(0);

      // Third request (rejected)
      const r3 = await rateLimit(id, 2, 10000);
      expect(r3.success).toBe(false);
      expect(r3.remaining).toBe(0);

      // Verify reset time is roughly 10s from now
      expect(r3.reset).toBeGreaterThan(Date.now());
      expect(r3.reset).toBeLessThanOrEqual(Date.now() + 10000);
    });
  });

  describe("2. Atomic concurrency test", () => {
    it("handles 200 concurrent requests with limit 50 perfectly", async () => {
      const id = "concurrent_test_id";
      const limit = 50;
      const requests = 200;

      const promises = Array.from({ length: requests }).map(() =>
        rateLimit(id, limit, 10000)
      );
      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes.length).toBe(50);
      expect(failures.length).toBe(150);

      const remainings = successes.map((r) => r.remaining).sort((a, b) => b - a);
      const expectedRemainings = Array.from({ length: 50 }).map((_, i) => 49 - i);
      expect(remainings).toEqual(expectedRemainings);

      // Verify stored Redis count
      const count = await redisClient.get(generateRateLimitKey(id));
      expect(count).toBe("50");
    });
  });

  describe("3. Distributed multi-instance test", () => {
    it("shares limits across multiple redis clients", async () => {
      const id = "multi_instance_id";
      const limit = 20;

      const clientA = new Redis(TEST_REDIS_URL);
      const clientB = new Redis(TEST_REDIS_URL);

      const promises = [];
      for (let i = 0; i < 25; i++) {
        promises.push(executeRateLimitScript(clientA, id, limit, 10000));
        promises.push(executeRateLimitScript(clientB, id, limit, 10000));
      }

      const results = await Promise.all(promises);
      const successes = results.filter((r) => r && r.allowed);
      const failures = results.filter((r) => r && !r.allowed);

      expect(successes.length).toBe(20);
      expect(failures.length).toBe(30);

      const count = await redisClient.get(generateRateLimitKey(id));
      expect(count).toBe("20");

      clientA.disconnect();
      clientB.disconnect();
    });
  });

  describe("4. Real multi-process test", () => {
    it("shares limits between actual Node processes (worker_threads)", async () => {
      const { Worker } = await import("worker_threads");
      const id = "real_multiprocess_id";
      const limit = 20;

      const runWorker = (testId: string, limitVal: number, useRedis: boolean) => {
        return new Promise<number>((resolve, reject) => {
          const env = { ...process.env };
          if (useRedis) {
            env.TEST_REDIS_URL = TEST_REDIS_URL;
            env.TEST_RL_PREFIX = testPrefix;
          } else {
            delete env.TEST_REDIS_URL;
            delete env.REDIS_URL;
          }

          const workerCode = `
            const { parentPort, workerData } = require('worker_threads');
            const { rateLimit } = require(workerData.rateLimitPath);
            
            async function main() {
              let successes = 0;
              for (let i = 0; i < workerData.limit; i++) {
                const result = await rateLimit(workerData.id, workerData.limit, 10000);
                if (result.success) successes++;
              }
              parentPort.postMessage(successes);
            }
            main().catch(err => { throw err; });
          `;

          const worker = new Worker(workerCode, {
            eval: true,
            env,
            workerData: {
              id: testId,
              limit: limitVal,
              rateLimitPath: path.resolve(
                __dirname,
                "../../src/server/middleware/rateLimit.ts"
              ),
            },
            execArgv: ["--require", "tsx/cjs"],
          });

          worker.on("message", resolve);
          worker.on("error", reject);
          worker.on("exit", (code) => {
            if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
          });
        });
      };

      // Negative control
      const idMemory = "multiprocess_mem";
      const [memA, memB] = await Promise.all([
        runWorker(idMemory, limit, false),
        runWorker(idMemory, limit, false),
      ]);
      expect(memA + memB).toBe(40);

      // Distributed Redis
      const idRedis = "multiprocess_redis";
      const [redisA, redisB] = await Promise.all([
        runWorker(idRedis, limit, true),
        runWorker(idRedis, limit, true),
      ]);
      expect(redisA + redisB).toBe(20);
    }, 15000);
  });

  describe("5. Backend failure", () => {
    it("fails closed when Redis is unreachable and does not expose exception", async () => {
      vi.stubEnv("TEST_REDIS_URL", "redis://localhost:9999"); // Unreachable
      const id = "backend_failure_id";

      const startTime = Date.now();
      const result = await rateLimit(id, 10, 60000);
      const duration = Date.now() - startTime;

      expect(result.success).toBe(false);
      expect(result.remaining).toBe(0);
      // Ensure it timed out within bounded time (5s connect timeout in config)
      // Actually ioredis will retry, but our first eval will fail or throw.
      // The function executeRateLimitScript catches it.
      expect(duration).toBeLessThan(10000);
    });
  });

  describe("6. Production configuration tests", () => {
    it("throws configuration error when production has no REDIS_URL", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("REDIS_URL", "");
      vi.stubEnv("TEST_REDIS_URL", "");

      await expect(rateLimit("test", 10, 10000)).rejects.toThrow(
        "Invalid server environment variables"
      );
    });

    it("throws configuration error when production uses redis:// instead of rediss://", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("REDIS_URL", "redis://localhost:6379");

      await expect(rateLimit("test", 10, 10000)).rejects.toThrow(
        "Invalid server environment variables"
      );
    });

    it("does not throw when production uses rediss://", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("REDIS_URL", "rediss://localhost:6379");

      // It will fail-closed because we can't actually connect to rediss://localhost:6379 in test,
      // but it should NOT throw a Configuration Error.
      const result = await rateLimit("test", 10, 10000);
      expect(result.success).toBe(false);
    });
  });

  describe("7. Expiration/TTL tests", () => {
    it("sets TTL on new window and preserves it on rejection", async () => {
      const id = "ttl_test";
      const windowMs = 5000;

      await rateLimit(id, 1, windowMs);

      const key = generateRateLimitKey(id);
      const pttl1 = await redisClient.pttl(key);
      expect(pttl1).toBeGreaterThan(0);
      expect(pttl1).toBeLessThanOrEqual(5000);

      // Reject request
      await rateLimit(id, 1, windowMs);
      const pttl2 = await redisClient.pttl(key);
      expect(pttl2).toBeGreaterThan(0);
      expect(pttl2).toBeLessThanOrEqual(pttl1); // TTL should not increase
    });

    it("treats ttl == -1 as corrupted state and starts a fresh window", async () => {
      const id = "ttl_corruption_test";
      const windowMs = 5000;
      const key = generateRateLimitKey(id);

      // Simulate corrupted state (key exists, no TTL)
      await redisClient.set(key, "10"); // No EX/PX

      const pttlBefore = await redisClient.pttl(key);
      expect(pttlBefore).toBe(-1); // Verify it has no TTL

      // Attempt to rate limit (limit = 5, but count was 10, so normally would reject)
      // Since TTL is -1, it should wipe it, start fresh, and allow the request
      const r = await rateLimit(id, 5, windowMs);
      expect(r.success).toBe(true);
      expect(r.remaining).toBe(4);

      // Verify count is now 1 and TTL is correct
      const countAfter = await redisClient.get(key);
      const pttlAfter = await redisClient.pttl(key);
      expect(countAfter).toBe("1");
      expect(pttlAfter).toBeGreaterThan(0);
    });
  });

  describe("8. Hashing tests", () => {
    it("handles extremely large identifiers safely and deterministically", () => {
      const largeId = "A".repeat(10000);
      const key1 = generateRateLimitKey(largeId);
      const key2 = generateRateLimitKey(largeId);

      expect(key1).toBe(key2);
      expect(key1.length).toBeLessThan(100);
      expect(key1).not.toContain("AAAA");
    });
  });

  describe("9. Client resilience", () => {
    // TCP proxy to the test Redis that holds every new connection for
    // `delayMs` before piping it through, simulating a slow cold TLS path.
    async function startDelayedProxy(delayMs: number) {
      const target = new URL(TEST_REDIS_URL);
      const server = net.createServer((client) => {
        client.pause();
        setTimeout(() => {
          const upstream = net.connect(
            Number(target.port || 6379),
            target.hostname,
            () => {
              client.pipe(upstream).pipe(client);
              client.resume();
            }
          );
          upstream.on("error", () => client.destroy());
          client.on("error", () => upstream.destroy());
        }, delayMs);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as net.AddressInfo;
      return { url: `redis://127.0.0.1:${port}`, close: () => server.close() };
    }

    async function waitForStatus(client: Redis, status: string, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (client.status !== status) {
        if (Date.now() > deadline) {
          throw new Error(`client stuck in ${client.status}, expected ${status}`);
        }
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    it("configures cold-start-tolerant timeouts without changing retry behaviour", () => {
      const client = getRedisClient()!;

      expect(REDIS_CONNECT_TIMEOUT_MS).toBe(3000);
      expect(REDIS_COMMAND_TIMEOUT_MS).toBe(2000);
      expect(client.options.connectTimeout).toBe(3000);
      expect(client.options.commandTimeout).toBe(2000);
      expect(client.options.lazyConnect).toBe(true);
      expect(client.options.maxRetriesPerRequest).toBe(1);
      expect(client.options.retryStrategy!(1)).toBe(100);
      expect(client.options.retryStrategy!(2)).toBeNull();
    });

    it("succeeds on a cold connection slower than the old 500ms command timeout", async () => {
      const proxy = await startDelayedProxy(1200);
      try {
        vi.stubEnv("TEST_REDIS_URL", proxy.url);

        const start = Date.now();
        const result = await rateLimit("cold_start_id", 5, 10000);

        expect(Date.now() - start).toBeGreaterThanOrEqual(1200);
        expect(result.success).toBe(true);
        expect(result.remaining).toBe(4);
      } finally {
        getRedisClient()?.disconnect();
        proxy.close();
      }
    });

    it("still fails closed within the command timeout when the cold path is too slow", async () => {
      const proxy = await startDelayedProxy(REDIS_COMMAND_TIMEOUT_MS + 1500);
      vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        vi.stubEnv("TEST_REDIS_URL", proxy.url);

        const start = Date.now();
        const result = await rateLimit("too_slow_id", 5, 10000);

        expect(result.success).toBe(false);
        expect(Date.now() - start).toBeLessThan(REDIS_COMMAND_TIMEOUT_MS + 1000);
      } finally {
        getRedisClient()?.disconnect();
        proxy.close();
      }
    });

    it("reuses a healthy cached client", async () => {
      const first = getRedisClient();
      await rateLimit("reuse_id", 5, 10000);

      expect(getRedisClient()).toBe(first);
      expect(first!.status).toBe("ready");
    });

    it("replaces a cached client that has reached the terminal 'end' state", async () => {
      const dead = getRedisClient()!;
      await dead.ping();
      dead.disconnect();
      await waitForStatus(dead, "end");

      const fresh = getRedisClient();
      expect(fresh).not.toBe(dead);

      const result = await rateLimit("replaced_client_id", 5, 10000);
      expect(result.success).toBe(true);
      expect(fresh!.status).toBe("ready");
    });

    it("keeps failing closed (no memory fallback) after a failed client is replaced", async () => {
      vi.stubEnv("TEST_REDIS_URL", "redis://localhost:9999"); // Unreachable
      vi.spyOn(console, "error").mockImplementation(() => {});

      const dead = getRedisClient()!;
      const first = await rateLimit("dead_backend_id", 1, 10000);
      await waitForStatus(dead, "end");

      // A limit of 1 would allow this under the in-memory fallback.
      const second = await rateLimit("dead_backend_id", 1, 10000);

      expect(first.success).toBe(false);
      expect(second.success).toBe(false);
      expect(getRedisClient()).not.toBe(dead);
    });

    it("does not log Redis credentials or the connection URL on failure", async () => {
      const secret = "TopSecretPassw0rd";
      const url = `redis://default:${secret}@localhost:9999`;
      vi.stubEnv("TEST_REDIS_URL", url);
      const logged: string[] = [];
      const capture = (...args: unknown[]) => {
        logged.push(
          args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" ")
        );
      };
      for (const level of ["error", "warn", "log", "info", "debug"] as const) {
        vi.spyOn(console, level).mockImplementation(capture);
      }

      const dead = getRedisClient()!;
      await rateLimit("secret_log_id", 5, 10000);
      await waitForStatus(dead, "end");
      await rateLimit("secret_log_id", 5, 10000);

      expect(logged.length).toBeGreaterThan(0);
      for (const line of logged) {
        expect(line).not.toContain(secret);
        expect(line).not.toContain("redis://");
      }
    });
  });
});
