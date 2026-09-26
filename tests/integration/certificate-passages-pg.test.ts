/**
 * Certificate sessions get passages that last the whole 300 s test, against a
 * real Postgres:
 *
 * - the data migration adds the long passages and retires the short ones,
 *   idempotently;
 * - session creation never serves a CERTIFICATE session a short passage, even
 *   one still marked active;
 * - a fast typist can type for the full 300 s and be VERIFIED, while a
 *   genuinely early certificate submission is still INVALID.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "crypto";
import { db } from "@/server/db";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { submitResult } from "@/server/services/session.service";
import { checkCertificateEligibility } from "@/server/services/certificate.service";
import { POST as createRoute } from "@/app/api/session/create/route";
import { getSeoRouteConfig } from "@/app/(seo)/[seoSlug]/seoConfig";
import { certificatePassages } from "@/features/typing/lib/passages";
import { CERTIFICATE_MIN_PASSAGE_CHARS, CHARS_PER_WORD } from "@/lib/constants";

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/server/middleware/rateLimit", () => ({
  rateLimit: vi
    .fn()
    .mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: 0 }),
}));

const MIGRATION = resolve(
  __dirname,
  "../../prisma/migrations/20260925000000_long_certificate_passages/migration.sql"
);

/** The migration's statements (the passage text contains no semicolons). */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, "utf8")
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

async function applyMigration() {
  for (const statement of migrationStatements()) {
    await db.$executeRawUnsafe(statement);
  }
}

const SHORT_CERTIFICATE =
  "A short certificate passage from before the fix, retired by the migration.";

const certificateTestConfig = getSeoRouteConfig(
  "typing-test-with-certificate"
)!.testConfig;

const createCertificateSession = async () => {
  const { mode, language, duration, trustTier } = certificateTestConfig;
  const res = await createRoute(
    new Request("http://localhost/api/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, language, duration, trustTier }),
    })
  );
  expect(res.status).toBe(201);
  return res.json();
};

beforeAll(async () => {
  // The state of an existing database before the migration: an active
  // certificate passage far too short for a 300 s test.
  await db.passage.create({
    data: {
      content: SHORT_CERTIFICATE,
      wordCount: SHORT_CERTIFICATE.split(/\s+/).length,
      charCount: SHORT_CERTIFICATE.length,
      mode: "CERTIFICATE",
    },
  });
});

describe("data migration", () => {
  it("adds every long certificate passage, active, with correct counts", async () => {
    await applyMigration();

    for (const p of certificatePassages) {
      const rows = await db.passage.findMany({ where: { content: p.content } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        mode: "CERTIFICATE",
        language: "ENGLISH",
        difficulty: "INTERMEDIATE",
        category: "certificate",
        isActive: true,
        wordCount: p.wordCount,
        charCount: p.content.length,
      });
      expect(rows[0]!.charCount).toBeGreaterThanOrEqual(CERTIFICATE_MIN_PASSAGE_CHARS);
    }
  });

  it("retires the short certificate passage without deleting it", async () => {
    const short = await db.passage.findFirstOrThrow({
      where: { content: SHORT_CERTIFICATE },
    });
    expect(short.isActive).toBe(false);
  });

  it("is idempotent", async () => {
    await applyMigration();
    for (const p of certificatePassages) {
      expect(await db.passage.count({ where: { content: p.content } })).toBe(1);
    }
  });
});

describe("certificate session passage selection", () => {
  it("never serves a CERTIFICATE session a passage shorter than the minimum", async () => {
    // Even if a short certificate passage is (re)activated.
    await db.passage.updateMany({
      where: { content: SHORT_CERTIFICATE },
      data: { isActive: true },
    });

    for (let i = 0; i < 20; i++) {
      const session = await createCertificateSession();
      expect(session.passage.content.length).toBeGreaterThanOrEqual(
        CERTIFICATE_MIN_PASSAGE_CHARS
      );
      expect(session.passage.content).not.toBe(SHORT_CERTIFICATE);
    }
  });
});

describe("submitting a certificate test", () => {
  let userId: string;
  const passage = certificatePassages[0]!;

  beforeAll(async () => {
    const user = await db.user.create({
      data: {
        id: randomUUID(),
        email: `cert-passages-${Date.now()}@x.com`,
        authId: randomUUID(),
      },
    });
    userId = user.id;
    // submitResult only accepts a submission from the session's owner.
    vi.mocked(getAuthenticatedUser).mockResolvedValue(user);
  });

  /** A correct trace at a steady `wpm` for `seconds`. */
  const traceAt = (wpm: number, seconds: number) => {
    const count = Math.floor(wpm * CHARS_PER_WORD * (seconds / 60));
    const intervalMs = 60_000 / (wpm * CHARS_PER_WORD);
    return Array.from({ length: count }, (_, i) => {
      const ch = passage.content[i]!;
      return [Math.floor(i * intervalMs), 0, i, ch] as [number, 0, number, string];
    });
  };

  async function submitCertificateTest(
    startedSecondsAgo: number,
    events: ReturnType<typeof traceAt>
  ) {
    const passageRow = await db.passage.findFirstOrThrow({
      where: { content: passage.content },
    });
    const token = `token-${randomUUID()}`;
    const session = await db.testSession.create({
      data: {
        userId,
        mode: "TIMED",
        language: "ENGLISH",
        duration: 300,
        trustTier: "CERTIFICATE",
        status: "ACTIVE",
        passageId: passageRow.id,
        integrityToken: token,
        startedAt: new Date(Date.now() - startedSecondsAgo * 1000),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const last = events[events.length - 1]!;
    return submitResult({
      sessionId: session.id,
      integrityToken: token,
      metrics: {
        wpm: 0,
        rawWpm: 0,
        accuracy: 1,
        correctChars: events.length,
        incorrectChars: 0,
        totalChars: events.length,
        correctedErrors: 0,
        uncorrectedErrors: 0,
        consistency: 0,
      },
      integritySignals: {
        pasteAttempts: 0,
        copyAttempts: 0,
        focusLossCount: 0,
        visibilityChanges: 0,
        suspiciousPattern: false,
        intervalWpms: [],
        selectionAttempts: 0,
      },
      eventTrace: { events, totalEvents: events.length, durationMs: last[0] },
    } as Parameters<typeof submitResult>[0]);
  }

  it("a 120 WPM typist types for the full 300 s, is VERIFIED and certificate-eligible", async () => {
    const events = traceAt(120, 300);
    expect(events.length).toBe(3000);
    expect(events.length).toBeLessThan(passage.content.length);

    const result = await submitCertificateTest(301, events);
    expect(result.integrityStatus).toBe("VERIFIED");

    const stored = await db.testResult.findUniqueOrThrow({
      where: { id: result.resultId },
    });
    expect(stored.scoringSource).toBe("SERVER_RECONSTRUCTED");
    expect(stored.netWpm).toBeGreaterThan(100);

    const eligibility = await checkCertificateEligibility(result.resultId);
    expect(eligibility.eligible).toBe(true);
  });

  it("still rejects a genuinely early certificate submission as INVALID", async () => {
    // Stops typing at 150 s and submits: early, and not because the passage ran out.
    const events = traceAt(120, 150);
    const result = await submitCertificateTest(151, events);
    expect(result.integrityStatus).toBe("INVALID");

    const eligibility = await checkCertificateEligibility(result.resultId);
    expect(eligibility.eligible).toBe(false);
  });
});
