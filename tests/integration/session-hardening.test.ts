/**
 * Phase 4C session/result hardening against real Postgres and the real route
 * handlers: duration policy, API error mapping, the paste → INVALID path, and
 * server-derived diagnostics.
 */
import { describe, it, expect, vi } from "vitest";
import { randomBytes, randomUUID } from "crypto";
import { db } from "@/server/db";
import { CreateSessionSchema } from "@/schemas/session.schema";
import { TEST_DURATIONS } from "@/lib/constants";
import { submitResult } from "@/server/services/session.service";
import { deriveTraceDiagnostics } from "@/features/typing/lib/traceAnalysis";
import { calculateCodeMetrics } from "@/features/typing/lib/codeMetrics";
import { POST as createRoute } from "@/app/api/session/create/route";
import { POST as startRoute } from "@/app/api/session/start/route";
import { POST as submitRoute } from "@/app/api/result/route";
import { GET as leaderboardRoute } from "@/app/api/leaderboard/route";

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: 0 }),
}));

const signals = (overrides = {}) => ({
  pasteAttempts: 0,
  copyAttempts: 0,
  focusLossCount: 0,
  visibilityChanges: 0,
  suspiciousPattern: false,
  intervalWpms: [],
  selectionAttempts: 0,
  ...overrides,
});
const clientMetrics = (n: number) => ({
  wpm: 999,
  rawWpm: 999,
  accuracy: 1,
  correctChars: n,
  incorrectChars: 0,
  totalChars: n,
  correctedErrors: 0,
  uncorrectedErrors: 0,
  consistency: 0.99,
});
const json = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function seedSession(opts: {
  content?: string;
  mode?: "TIMED" | "CODE";
  status?: "PENDING" | "ACTIVE" | "COMPLETED";
  userId?: string | null;
  duration?: number;
  startedAgoMs?: number;
}) {
  const content = opts.content ?? "the quick brown fox jumps over the lazy dog";
  const passage = await db.passage.create({
    data: {
      content,
      wordCount: content.split(" ").length,
      charCount: content.length,
      ...(opts.mode === "CODE" ? { language: "CODE", codeLanguage: "JAVASCRIPT" } : {}),
    },
  });
  const integrityToken = `hard-${randomBytes(6).toString("hex")}`;
  const session = await db.testSession.create({
    data: {
      userId: opts.userId ?? null,
      mode: opts.mode ?? "TIMED",
      language: opts.mode === "CODE" ? "CODE" : "ENGLISH",
      duration: opts.duration ?? 15,
      trustTier: "FREE",
      status: opts.status ?? "ACTIVE",
      passageId: passage.id,
      integrityToken,
      ...(opts.status === "PENDING"
        ? {}
        : { startedAt: new Date(Date.now() - (opts.startedAgoMs ?? 16_000)) }),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return { session, integrityToken, content };
}

/** A correct trace over `text`, one char every `stepMs`. */
const traceFor = (text: string, stepMs = 150) => {
  const events = [...text].map(
    (ch, i) => [(i + 1) * stepMs, 0, i, ch] as [number, 0, number, string]
  );
  return { events, totalEvents: events.length, durationMs: text.length * stepMs };
};

describe("session duration policy", () => {
  const base = { mode: "timed" as const, language: "english" as const };

  it.each(TEST_DURATIONS)("accepts the standard duration %ss", (duration) => {
    expect(CreateSessionSchema.safeParse({ ...base, duration }).success).toBe(true);
  });

  it.each([0, -5, 7, 45, 61, 100_000, 1.5])("rejects duration %s", (duration) => {
    expect(CreateSessionSchema.safeParse({ ...base, duration }).success).toBe(false);
  });

  it("applies the same set to certificate and code sessions", () => {
    expect(
      CreateSessionSchema.safeParse({ ...base, duration: 300, certificateMode: true })
        .success
    ).toBe(true);
    expect(
      CreateSessionSchema.safeParse({ ...base, duration: 45, certificateMode: true })
        .success
    ).toBe(false);
    expect(
      CreateSessionSchema.safeParse({
        mode: "code",
        language: "code",
        codeLanguage: "python",
        duration: 60,
      }).success
    ).toBe(true);
    expect(
      CreateSessionSchema.safeParse({
        mode: "code",
        language: "code",
        codeLanguage: "python",
        duration: 45,
      }).success
    ).toBe(false);
  });

  it("does not require or restrict duration for words and practice modes", () => {
    expect(
      CreateSessionSchema.safeParse({ mode: "words", language: "english", wordCount: 25 })
        .success
    ).toBe(true);
    expect(
      CreateSessionSchema.safeParse({ mode: "practice", language: "english" }).success
    ).toBe(true);
  });

  it("exempts B2B invite sessions, whose duration comes from the assessment", () => {
    expect(
      CreateSessionSchema.safeParse({
        ...base,
        duration: 45,
        inviteToken: "tok",
        attemptId: randomUUID(),
      }).success
    ).toBe(true);
  });

  it("does not exempt an inviteToken without an attemptId (not a B2B session)", () => {
    // createSession only takes the B2B path when BOTH are present; otherwise
    // this would create an ordinary FREE session with a 1-second duration.
    expect(
      CreateSessionSchema.safeParse({ ...base, duration: 1, inviteToken: "anything" })
        .success
    ).toBe(false);
    expect(
      CreateSessionSchema.safeParse({ ...base, duration: 1, attemptId: randomUUID() })
        .success
    ).toBe(false);
  });

  it("rejects a non-uuid sourceResultId instead of reaching the database", () => {
    expect(
      CreateSessionSchema.safeParse({
        mode: "practice",
        language: "english",
        sourceResultId: "abc",
      }).success
    ).toBe(false);
  });

  it("returns 400 from the create route for a non-standard duration", async () => {
    const res = await createRoute(json({ ...base, duration: 45 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("leaderboard query validation", () => {
  const get = (qs: string) =>
    leaderboardRoute(new Request(`http://localhost/api/leaderboard?${qs}`));

  it.each([
    "language=klingon",
    "mode=bogus",
    "codeLanguage=cobol",
    "period=bogus",
    "duration=abc",
    "duration=45",
    "duration=-1",
    "limit=0",
    "limit=1000",
    "limit=1.5",
    "offset=-1",
  ])("returns 400 for %s", async (qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid query parameters");
    expect(JSON.stringify(body)).not.toMatch(/prisma|22P02|invalid input value/i);
  });

  it.each([
    "",
    "period=weekly",
    "mode=timed&duration=30&language=english&limit=10&offset=0",
  ])("returns 200 for valid query '%s'", async (qs) => {
    const res = await get(qs);
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).entries)).toBe(true);
  });
});

describe("session start/submit error mapping", () => {
  it("start: wrong integrity token → 403", async () => {
    const { session } = await seedSession({ status: "PENDING" });
    const res = await startRoute(
      json({ sessionId: session.id, integrityToken: "wrong-token" })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("start: someone else's session → 403", async () => {
    const owner = await db.user.create({
      data: {
        authId: randomUUID(),
        email: `own-${randomBytes(3).toString("hex")}@example.com`,
      },
    });
    const { session, integrityToken } = await seedSession({
      status: "PENDING",
      userId: owner.id,
    });
    const res = await startRoute(json({ sessionId: session.id, integrityToken }));
    expect(res.status).toBe(403);
  });

  it("start: unknown session → 400 INVALID_SESSION", async () => {
    const res = await startRoute(json({ sessionId: randomUUID(), integrityToken: "x" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_SESSION");
  });

  it("start: malformed body → 400", async () => {
    const res = await startRoute(json({ sessionId: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("submit: wrong integrity token → 403", async () => {
    const { session, content } = await seedSession({});
    const res = await submitRoute(
      json({
        sessionId: session.id,
        integrityToken: "wrong",
        metrics: clientMetrics(3),
        integritySignals: signals(),
        eventTrace: traceFor(content.slice(0, 3)),
      })
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("submit: someone else's session → 403", async () => {
    const owner = await db.user.create({
      data: {
        authId: randomUUID(),
        email: `own-${randomBytes(3).toString("hex")}@example.com`,
      },
    });
    const { session, integrityToken, content } = await seedSession({ userId: owner.id });
    const res = await submitRoute(
      json({
        sessionId: session.id,
        integrityToken,
        metrics: clientMetrics(3),
        integritySignals: signals(),
        eventTrace: traceFor(content.slice(0, 3)),
      })
    );
    expect(res.status).toBe(403);
  });

  it("submit: session not ACTIVE → 400 INVALID_SESSION", async () => {
    const { session, integrityToken } = await seedSession({ status: "COMPLETED" });
    const res = await submitRoute(
      json({
        sessionId: session.id,
        integrityToken,
        metrics: clientMetrics(0),
        integritySignals: signals(),
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_SESSION");
  });

  it("submit: malformed body → 400 VALIDATION_ERROR", async () => {
    const res = await submitRoute(json({ sessionId: randomUUID() }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("submitResult — paste and diagnostics (real path)", () => {
  it("paste attempt → INVALID with zeroed trusted metrics and retained counts", async () => {
    const { session, integrityToken, content } = await seedSession({});
    const typed = content.slice(0, 40);
    const res = await submitResult({
      sessionId: session.id,
      integrityToken,
      metrics: clientMetrics(40),
      integritySignals: signals({ pasteAttempts: 1 }),
      eventTrace: traceFor(typed),
    });

    expect(res.integrityStatus).toBe("INVALID");
    const row = await db.testResult.findUniqueOrThrow({
      where: { sessionId: session.id },
    });
    expect(row).toMatchObject({ wpm: 0, rawWpm: 0, netWpm: 0, accuracy: 0 });
    expect(row.correctChars).toBe(40);
    expect(row.scoringSource).toBe("SERVER_RECONSTRUCTED");
    expect(row.traceHash).toMatch(/^[0-9a-f]{64}$/);
    const s = await db.testSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(s.status).toBe("COMPLETED");
  });

  it("stores trace-derived errorMap and consistency, not the client's, for reconstructed results", async () => {
    const content = "abcdefghij".repeat(12);
    const { session, integrityToken } = await seedSession({ content });
    // 15 s of typing with one wrong key that gets corrected.
    const events: Array<[number, 0, number, string] | [number, 1, number]> = [];
    let t = 0;
    for (let i = 0; i < 70; i++) {
      if (i === 10) events.push([(t += 100), 0, 10, "z"], [(t += 100), 1, 10]);
      events.push([(t += 200), 0, i, content[i]!]);
    }
    const trace = { events, totalEvents: events.length, durationMs: t };

    await submitResult({
      sessionId: session.id,
      integrityToken,
      metrics: clientMetrics(70),
      integritySignals: signals({ intervalWpms: [999, 999, 999] }),
      errorMap: {
        q: { expected: "q", actual: ["w"], count: 42, corrected: 0, uncorrected: 42 },
      },
      eventTrace: trace as never,
    });

    const row = await db.testResult.findUniqueOrThrow({
      where: { sessionId: session.id },
    });
    const expected = deriveTraceDiagnostics(content, trace as never);
    expect(row.scoringSource).toBe("SERVER_RECONSTRUCTED");
    expect(row.errorMap).toEqual(expected.keyErrors);
    expect(row.errorMap).not.toHaveProperty("q");
    expect(
      (row.errorMap as Record<string, { corrected: number }>)[content[10]!]!.corrected
    ).toBe(1);
    expect(row.consistency).toBe(expected.consistency);
    expect(row.consistency).not.toBe(0.99);
  });

  it("keeps client-reported diagnostics only for CLIENT_COUNTS results (no trace)", async () => {
    const { session, integrityToken } = await seedSession({});
    const clientErrors = {
      e: { expected: "e", actual: ["r"], count: 2, corrected: 0, uncorrected: 2 },
    };
    await submitResult({
      sessionId: session.id,
      integrityToken,
      metrics: clientMetrics(10),
      integritySignals: signals(),
      errorMap: clientErrors,
    });

    const row = await db.testResult.findUniqueOrThrow({
      where: { sessionId: session.id },
    });
    expect(row.scoringSource).toBe("CLIENT_COUNTS");
    expect(row.integrityStatus).toBe("REVIEW");
    expect(row.errorMap).toEqual(clientErrors);
    expect(row.codeMetrics).toBeNull();
  });

  it("computes code metrics from per-position errors in the trace", async () => {
    const code = "const a = 1;\nconst b = 2;";
    const { session, integrityToken } = await seedSession({
      content: code,
      mode: "CODE",
    });
    const typed = code.replace(/;/, ","); // first ";" typed as ","
    const trace = traceFor(typed, 100);

    await submitResult({
      sessionId: session.id,
      integrityToken,
      metrics: clientMetrics(typed.length),
      integritySignals: signals(),
      errorMap: {},
      eventTrace: trace,
    });

    const row = await db.testResult.findUniqueOrThrow({
      where: { sessionId: session.id },
    });
    const expected = calculateCodeMetrics(
      code,
      deriveTraceDiagnostics(code, trace).positionErrors
    );
    expect(row.codeMetrics).toEqual(expected);
    expect((row.codeMetrics as { punctuationErrors: number }).punctuationErrors).toBe(1);
  });
});
