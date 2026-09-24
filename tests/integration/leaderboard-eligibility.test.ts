/**
 * Leaderboard eligibility against real Postgres: the raw SQL path in
 * getLeaderboard(), which tests/integration/leaderboard.test.ts only mocks.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomBytes, randomUUID } from "crypto";
import { db } from "@/server/db";
import { getLeaderboard } from "@/server/services/leaderboard.service";

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));

const run = randomBytes(3).toString("hex");
let passageId: string;

type Case = {
  trustTier?: "FREE" | "CERTIFICATE" | "B2B_ASSESSMENT";
  integrityStatus?: "VERIFIED" | "REVIEW" | "INVALID";
  scoringSource?: "CLIENT_COUNTS" | "SERVER_RECONSTRUCTED";
  duration?: number;
  netWpm?: number;
  accuracy?: number;
  optOut?: boolean;
  certificate?: "PENDING_PAYMENT" | "ACTIVE" | "REVOKED" | "EXPIRED";
};

/** One user with one completed TIMED result; returns the result's shareId. */
async function seed(label: string, c: Case = {}): Promise<string> {
  const user = await db.user.create({
    data: {
      authId: randomUUID(),
      email: `lb-${run}-${label}@example.com`,
      leaderboardOptOut: c.optOut ?? false,
    },
  });
  const duration = c.duration ?? 60;
  const session = await db.testSession.create({
    data: {
      userId: user.id,
      mode: "TIMED",
      language: "ENGLISH",
      duration,
      trustTier: c.trustTier ?? "FREE",
      status: "COMPLETED",
      passageId,
      integrityToken: `lb-${run}-${label}`,
      startedAt: new Date(Date.now() - duration * 1000),
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const shareId = `lb${run}${label}`.slice(0, 21);
  const netWpm = c.netWpm ?? 60;
  const result = await db.testResult.create({
    data: {
      sessionId: session.id,
      userId: user.id,
      shareId,
      wpm: netWpm,
      rawWpm: netWpm,
      netWpm,
      accuracy: c.accuracy ?? 0.98,
      correctChars: 300,
      incorrectChars: 0,
      totalChars: 300,
      correctedErrors: 0,
      uncorrectedErrors: 0,
      elapsedMs: duration * 1000,
      duration,
      integrityStatus: c.integrityStatus ?? "VERIFIED",
      scoringSource: c.scoringSource ?? "SERVER_RECONSTRUCTED",
    },
  });
  if (c.certificate) {
    await db.certificate.create({
      data: {
        certificateId: `LB${run}${label}`.slice(0, 20),
        verificationHash: "h".repeat(64),
        userId: user.id,
        resultId: result.id,
        status: c.certificate,
        testType: "TIMED Typing Assessment",
        language: "ENGLISH",
        duration,
        wpm: netWpm,
        rawWpm: netWpm,
        accuracy: c.accuracy ?? 0.98,
      },
    });
  }
  return shareId;
}

const ids: Record<string, string> = {};
const board = async (query: Parameters<typeof getLeaderboard>[0]) =>
  (await getLeaderboard({ limit: 100, ...query })).entries;
const shareIds = (entries: { shareId: string }[]) => entries.map((e) => e.shareId);

beforeAll(async () => {
  const passage = await db.passage.create({
    data: { content: "leaderboard eligibility passage", wordCount: 3, charCount: 31 },
  });
  passageId = passage.id;

  const cases: Record<string, Case> = {
    freeTrusted: {},
    freeClientCounts: { scoringSource: "CLIENT_COUNTS" },
    freeReview: { integrityStatus: "REVIEW" },
    certTrusted: { trustTier: "CERTIFICATE" },
    certTrustedPending: { trustTier: "CERTIFICATE", certificate: "PENDING_PAYMENT" },
    certTrustedActive: { trustTier: "CERTIFICATE", certificate: "ACTIVE" },
    certClientCounts: { trustTier: "CERTIFICATE", scoringSource: "CLIENT_COUNTS" },
    certReview: { trustTier: "CERTIFICATE", integrityStatus: "REVIEW" },
    certInvalid: { trustTier: "CERTIFICATE", integrityStatus: "INVALID" },
    certRevoked: { trustTier: "CERTIFICATE", certificate: "REVOKED" },
    certExpired: { trustTier: "CERTIFICATE", certificate: "EXPIRED" },
    optedOut: { optOut: true },
    b2b: { trustTier: "B2B_ASSESSMENT" },
    free30: { duration: 30 },
    cert300: { trustTier: "CERTIFICATE", duration: 300, netWpm: 45, accuracy: 0.97 },
  };
  for (const [label, c] of Object.entries(cases)) ids[label] = await seed(label, c);
});

describe("leaderboard eligibility (real SQL)", () => {
  it("includes trusted FREE and CERTIFICATE results", async () => {
    const listed = shareIds(await board({ period: "all-time" }));
    for (const label of [
      "freeTrusted",
      "certTrusted",
      "certTrustedPending",
      "certTrustedActive",
    ]) {
      expect(listed, label).toContain(ids[label]);
    }
  });

  it.each([
    ["freeClientCounts", "FREE + CLIENT_COUNTS"],
    ["freeReview", "FREE + REVIEW"],
    ["certClientCounts", "CERTIFICATE + VERIFIED + CLIENT_COUNTS"],
    ["certReview", "CERTIFICATE + REVIEW"],
    ["certInvalid", "CERTIFICATE + INVALID"],
    ["certRevoked", "revoked certificate"],
    ["certExpired", "expired certificate"],
    ["optedOut", "opted-out user"],
    ["b2b", "B2B assessment"],
  ])("excludes %s (%s)", async (label) => {
    const listed = shareIds(await board({ period: "all-time" }));
    expect(listed).not.toContain(ids[label]);
  });

  it("scopes a timed board to one duration (60 s by default)", async () => {
    const defaultBoard = await board({ period: "all-time" });
    expect(shareIds(defaultBoard)).not.toContain(ids.free30);
    expect(defaultBoard.every((e) => e.duration === 60)).toBe(true);

    const board30 = shareIds(
      await board({ period: "all-time", mode: "timed", duration: 30 })
    );
    expect(board30).toContain(ids.free30);
    expect(board30).not.toContain(ids.freeTrusted);
  });

  it("flags certificate eligibility with the issuance rule", async () => {
    const at300 = await board({ period: "all-time", mode: "timed", duration: 300 });
    expect(at300.find((e) => e.shareId === ids.cert300)?.isCertificateEligible).toBe(
      true
    );

    // Trusted CERTIFICATE result, but 60 s is below the certificate minimum.
    const at60 = await board({ period: "all-time" });
    expect(at60.find((e) => e.shareId === ids.certTrusted)?.isCertificateEligible).toBe(
      false
    );
  });
});
