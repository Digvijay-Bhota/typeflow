import { describe, it, expect, vi, afterEach } from "vitest";
import {
  logger,
  logRequestFailure,
  redactString,
  redactValue,
  serializeError,
  REDACTED,
} from "@/lib/logger";
import { ServiceError } from "@/server/errors";

// Fake values only.
const FAKE_DB_URL = "postgresql://app_user:fake-db-pass-123@db.example.test:5432/app";
const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fakeSignatureValue123";
const SECRETS = [
  "fake-db-pass-123",
  "fake-webhook-secret-xyz",
  "fake-api-key-abc",
  "fake-session-token-999",
  "fake-password-!!",
  "fake-cookie-value",
  "fakeSignatureValue123",
];

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  return {
    out,
    err,
    all: () => [...out, ...err].join(""),
    entries: () => [...out, ...err].map((line) => JSON.parse(line)),
  };
}

function expectNoSecrets(text: string) {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toContain("[object Object]");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("logger output", () => {
  it("writes info as one JSON line to stdout", () => {
    const c = capture();
    logger.info("test info", { foo: "bar" });
    expect(c.out).toHaveLength(1);
    expect(c.err).toHaveLength(0);
    expect(JSON.parse(c.out[0]!)).toMatchObject({
      level: "info",
      message: "test info",
      context: { foo: "bar" },
    });
  });

  it("writes warn and error to stderr", () => {
    const c = capture();
    logger.warn("test warn", { foo: "bar" });
    logger.error("test error", new Error("oops"), { foo: "bar" });
    expect(c.out).toHaveLength(0);
    expect(c.entries().map((e) => e.level)).toEqual(["warn", "error"]);
  });

  it("supports child loggers", () => {
    const c = capture();
    logger.child({ reqId: "123" }).info("test child info", { extra: true });
    expect(c.entries()[0]).toMatchObject({ context: { reqId: "123", extra: true } });
  });

  it("logs a string error", () => {
    const c = capture();
    logger.error("test error", "string error");
    expect(c.entries()[0].error).toEqual({ name: "NonError", message: "string error" });
  });
});

describe("error serialization", () => {
  it("serializes Error name, message, code, status, stack and cause", () => {
    const cause = new Error("connection reset");
    const err = Object.assign(new TypeError("boom", { cause }), {
      code: "E_BOOM",
      status: 502,
    });
    const s = serializeError(err);
    expect(s).toMatchObject({
      name: "TypeError",
      message: "boom",
      code: "E_BOOM",
      status: 502,
    });
    expect(s.stack).toContain("TypeError: boom");
    expect(s.stack).toContain("logger.test.ts");
    expect(s.cause).toMatchObject({ name: "Error", message: "connection reset" });
  });

  it("keeps a ServiceError's code and status", () => {
    expect(serializeError(new ServiceError("Nope", "FORBIDDEN", 403))).toMatchObject({
      name: "ServiceError",
      message: "Nope",
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("keeps Prisma's code and meta", () => {
    const err = Object.assign(new Error("Unique constraint failed"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: { target: ["resultId"] },
    });
    expect(serializeError(err)).toMatchObject({
      code: "P2002",
      meta: { target: ["resultId"] },
    });
  });

  it("regression: a plain object is serialized as JSON, never '[object Object]'", () => {
    const c = capture();
    logger.error("Failed to create session", { error: "DB timeout", statusCode: 504 });
    const entry = c.entries()[0];
    expect(entry.error).toMatchObject({ name: "NonError", status: 504 });
    expect(entry.error.message).toContain("DB timeout");
    expectNoSecrets(c.all());
  });

  it("serializes Error values nested in context", () => {
    const c = capture();
    logger.warn("Retrying", { error: new Error("transient") });
    expect(c.entries()[0].context.error).toMatchObject({
      name: "Error",
      message: "transient",
    });
  });

  it("does not copy arbitrary Error properties (e.g. a client's request config)", () => {
    const err = Object.assign(new Error("Request failed with status 401"), {
      config: { headers: { Authorization: "Bearer fake-api-key-abc" } },
      command: { name: "auth", args: ["fake-password-!!"] },
    });
    const text = JSON.stringify(serializeError(err));
    expectNoSecrets(text);
    expect(text).not.toContain("config");
  });

  it("handles cycles, binary data, depth and odd values", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 10; i++) deep = (deep.next = {}) as Record<string, unknown>;
    const v = redactValue({
      a,
      root,
      bytes: new Uint8Array(3),
      big: 10n,
      when: new Date("2026-01-01T00:00:00.000Z"),
      fn: () => 1,
      list: Array.from({ length: 60 }, (_, i) => i),
    }) as Record<string, unknown>;
    expect((v.a as Record<string, unknown>).self).toBe("[Circular]");
    expect(JSON.stringify(v.root)).toContain("[Truncated]");
    expect(v.bytes).toBe("[Binary 3 bytes]");
    expect(v.big).toBe("10");
    expect(v.when).toBe("2026-01-01T00:00:00.000Z");
    expect(v.fn).toBeUndefined();
    expect((v.list as unknown[]).at(-1)).toBe("[10 more]");
    expect(serializeError(42)).toEqual({ name: "NonError", message: "42" });
  });
});

describe("redaction", () => {
  it("redacts sensitive keys at any depth", () => {
    const v = redactValue({
      password: "fake-password-!!",
      RAZORPAY_WEBHOOK_SECRET: "fake-webhook-secret-xyz",
      apiKey: "fake-api-key-abc",
      headers: { authorization: "Bearer fake-api-key-abc", cookie: "fake-cookie-value" },
      session: { integrityToken: "fake-session-token-999" },
      DATABASE_URL: FAKE_DB_URL,
      items: [{ razorpay_signature: "fakeSignatureValue123" }],
      certificateId: "TF-2026-ABCDEF",
      passageId: "p1",
    }) as Record<string, unknown>;
    expectNoSecrets(JSON.stringify(v));
    expect(v.password).toBe(REDACTED);
    expect(v.certificateId).toBe("TF-2026-ABCDEF");
    expect(v.passageId).toBe("p1");
  });

  it("redacts credentials embedded in strings", () => {
    const text = redactString(
      `connect failed: ${FAKE_DB_URL} with Authorization: Bearer fake-api-key-abc ` +
        `key ${FAKE_JWT} callback?token=fake-session-token-999&x=1 password=fake-password-!!`
    );
    expectNoSecrets(text);
    expect(text).toContain("postgresql://[REDACTED]@db.example.test:5432/app");
    expect(text).toContain("x=1");
  });

  it("redacts messages, error messages, stacks and context in the written line", () => {
    const c = capture();
    const err = new Error(`Can't reach ${FAKE_DB_URL}`);
    logger.error(`Startup with ${FAKE_DB_URL}`, err, {
      env: { DIRECT_URL: FAKE_DB_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_JWT },
    });
    expectNoSecrets(c.all());
    expect(c.entries()[0].error.stack).toContain("postgresql://[REDACTED]@");
  });
});

describe("production diagnostics", () => {
  it("keeps the stack trace in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { logger: prodLogger } = await import("@/lib/logger");
    const c = capture();
    prodLogger.error("Failed to submit result", new RangeError("bad range"), {
      requestId: "req-1",
    });
    const entry = c.entries()[0];
    expect(c.err).toHaveLength(1);
    expect(entry).toMatchObject({
      level: "error",
      message: "Failed to submit result",
      context: { requestId: "req-1" },
      error: { name: "RangeError", message: "bad range" },
    });
    expect(entry.error.stack).toMatch(/RangeError: bad range\n\s+at /);
  });
});

describe("logRequestFailure", () => {
  it("logs unexpected failures as errors with the stack", () => {
    const c = capture();
    logRequestFailure("Failed", new Error("db down"), {
      requestId: "r1",
      route: "POST /x",
    });
    const entry = c.entries()[0];
    expect(entry).toMatchObject({
      level: "error",
      context: { requestId: "r1", route: "POST /x" },
    });
    expect(entry.error.stack).toContain("db down");
  });

  it("logs expected client errors (status < 500) as warnings without a stack", () => {
    const c = capture();
    logRequestFailure("Failed", new ServiceError("Session expired", "GONE", 410), {
      requestId: "r2",
    });
    const entry = c.entries()[0];
    expect(entry).toMatchObject({
      level: "warn",
      context: {
        requestId: "r2",
        error: { name: "ServiceError", code: "GONE", status: 410 },
      },
    });
    expect(entry.context.error.stack).toBeUndefined();
  });

  it("treats a 5xx ServiceError as an error", () => {
    const c = capture();
    logRequestFailure("Failed", new ServiceError("Unavailable", "UNAVAILABLE", 503), {});
    expect(c.entries()[0].level).toBe("error");
  });
});
