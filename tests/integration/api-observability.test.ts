/**
 * Error handling of the core session/result routes: the log carries the real
 * error (name, message, stack) under the same requestId the client gets back,
 * and the response stays a sanitized public error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as createSessionRoute } from "@/app/api/session/create/route";
import { POST as startSessionRoute } from "@/app/api/session/start/route";
import { POST as submitResultRoute } from "@/app/api/result/route";
import { GET as getResultRoute } from "@/app/api/result/[shareId]/route";
import {
  createSession,
  startSession,
  submitResult,
} from "@/server/services/session.service";
import { getResultByShareId } from "@/server/services/result.service";
import { ServiceError } from "@/server/errors";
import { rateLimit } from "@/server/middleware/rateLimit";

vi.mock("@/server/services/session.service", () => ({
  createSession: vi.fn(),
  startSession: vi.fn(),
  submitResult: vi.fn(),
}));
vi.mock("@/server/services/result.service", () => ({
  getResultByShareId: vi.fn(),
}));
vi.mock("@/server/middleware/rateLimit", () => ({ rateLimit: vi.fn() }));

// Fake values only.
const FAKE_DB_URL = "postgresql://app_user:fake-db-pass-123@db.example.test:5432/app";

const post = (url: string, body: unknown) =>
  new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify(body),
  });

const SUBMIT_BODY = {
  sessionId: "123e4567-e89b-12d3-a456-426614174000",
  integrityToken: "fake-integrity-token",
  clientElapsedMs: 60000,
  metrics: {
    wpm: 60,
    rawWpm: 60,
    accuracy: 1,
    correctChars: 300,
    incorrectChars: 0,
    totalChars: 300,
    correctedErrors: 0,
    uncorrectedErrors: 0,
    consistency: 0.9,
  },
  errorMap: {},
  integritySignals: {
    pasteAttempts: 0,
    copyAttempts: 0,
    focusLossCount: 0,
    visibilityChanges: 0,
    suspiciousPattern: false,
    intervalWpms: [60],
    selectionAttempts: 0,
  },
};

type Case = {
  name: string;
  failing: () => ReturnType<typeof vi.fn>;
  call: () => Promise<Response>;
  internalMessage: string;
};

const CASES: Case[] = [
  {
    name: "POST /api/session/create",
    failing: () => vi.mocked(createSession),
    call: () =>
      createSessionRoute(
        post("http://localhost/api/session/create", {
          mode: "timed",
          language: "english",
          duration: 60,
        })
      ),
    internalMessage: "Failed to create session.",
  },
  {
    name: "POST /api/session/start",
    failing: () => vi.mocked(startSession),
    call: () =>
      startSessionRoute(
        post("http://localhost/api/session/start", {
          sessionId: "123e4567-e89b-12d3-a456-426614174000",
          integrityToken: "fake-integrity-token",
        })
      ),
    internalMessage: "Failed to start session.",
  },
  {
    name: "POST /api/result",
    failing: () => vi.mocked(submitResult),
    call: () => submitResultRoute(post("http://localhost/api/result", SUBMIT_BODY)),
    internalMessage: "Failed to submit result.",
  },
  {
    name: "GET /api/result/[shareId]",
    failing: () => vi.mocked(getResultByShareId),
    call: () =>
      getResultRoute(new NextRequest("http://localhost/api/result/abc123"), {
        params: Promise.resolve({ shareId: "abc123" }),
      }),
    internalMessage: "Failed to retrieve result.",
  },
];

let lines: string[];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(rateLimit).mockResolvedValue({
    success: true,
    limit: 10,
    remaining: 9,
    reset: 0,
  });
  lines = [];
  const capture = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capture);
  vi.spyOn(process.stderr, "write").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const entries = () =>
  lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any

describe.each(CASES)(
  "$name error handling",
  ({ name, failing, call, internalMessage }) => {
    it("logs the real error with its stack, correlated by requestId, and returns a sanitized 500", async () => {
      failing().mockRejectedValueOnce(
        new Error(`Can't reach database server at ${FAKE_DB_URL}`)
      );

      const res = await call();
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body).toEqual({
        error: {
          requestId: expect.any(String),
          code: "INTERNAL_ERROR",
          message: internalMessage,
        },
      });
      const text = JSON.stringify(body);
      expect(text).not.toContain("database");
      expect(text).not.toContain("stack");

      const [entry] = entries();
      expect(entry).toMatchObject({
        level: "error",
        context: { requestId: body.error.requestId, route: name },
        error: { name: "Error" },
      });
      expect(entry!.error.message).toContain("Can't reach database server");
      expect(entry!.error.stack).toContain("api-observability.test.ts");
      const logged = lines.join("");
      expect(logged).not.toContain("[object Object]");
      expect(logged).not.toContain("fake-db-pass-123");
    });

    it("maps a ServiceError to its public response and logs it as a warning", async () => {
      failing().mockRejectedValueOnce(
        new ServiceError("Session has expired", "SESSION_EXPIRED", 410)
      );

      const res = await call();

      if (name === "GET /api/result/[shareId]") {
        // This route has no ServiceError mapping: still a generic 500.
        expect(res.status).toBe(500);
        return;
      }
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.error).toMatchObject({
        code: "SESSION_EXPIRED",
        message: "Session has expired",
      });
      const [entry] = entries();
      expect(entry).toMatchObject({
        level: "warn",
        context: {
          requestId: body.error.requestId,
          error: { name: "ServiceError", code: "SESSION_EXPIRED", status: 410 },
        },
      });
      expect(entry!.context.error.stack).toBeUndefined();
    });

    it("serializes a non-Error rejection instead of '[object Object]'", async () => {
      failing().mockRejectedValueOnce({ code: "ETIMEDOUT", detail: "upstream timeout" });

      const res = await call();

      expect(res.status).toBe(500);
      const [entry] = entries();
      expect(entry!.error).toMatchObject({ name: "NonError", code: "ETIMEDOUT" });
      expect(entry!.error.message).toContain("upstream timeout");
    });
  }
);

it("POST /api/session/create keeps the DUPLICATE_SESSION response", async () => {
  vi.mocked(createSession).mockRejectedValueOnce(
    new ServiceError("DUPLICATE_SESSION", "CONFLICT", 409)
  );
  const res = await CASES[0]!.call();
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatchObject({
    code: "CONFLICT",
    message: "A session already exists for this attempt.",
  });
});
