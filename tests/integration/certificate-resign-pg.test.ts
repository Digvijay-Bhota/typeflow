/**
 * One-off legacy certificate re-sign (Phase 5C-9) against real Postgres.
 *
 * The six certificate ids are hard-coded in the service, so the fixtures use
 * them and are deleted before every test; no other test file uses them.
 * Legacy fixtures are signed with a stand-in for the old SESSION_SECRET;
 * CERTIFICATE_SIGNING_SECRET comes from tests/setup/test-env.ts.
 *
 * Remove this file together with the service and route.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHmac, randomBytes, randomUUID } from "crypto";
import { db } from "@/server/db";
import { __clearServerEnvForTesting } from "@/lib/env";
import {
  generateVerificationHash,
  getCertificateVerification,
} from "@/server/services/certificate.service";
import {
  LEGACY_CERTIFICATE_IDS,
  RESIGN_ACTION,
  RESIGN_ROLLBACK_ACTION,
  SIGNING_CUTOVER,
  othersUnchanged,
  resignLegacyCertificates,
  type ResignSummary,
} from "@/server/services/certificateResign.service";
import * as resignRoute from "@/app/api/cron/resign-legacy-certificates/route";

// Each test seeds six full purchases and runs the operation several times.
vi.setConfig({ testTimeout: 20_000 });

const CRON_SECRET = "test-only-cron-secret-0123456789abcdef";
const LEGACY_SECRET = "stand-in-for-the-old-session-secret-000000";

beforeAll(() => {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  __clearServerEnvForTesting();
});

afterAll(() => {
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});

const [C9XGPR, B64BP7J, LR88NY, AREJKD, TVY3N3, PT8BB9] = LEGACY_CERTIFICATE_IDS;

const legacyHash = (certificateId: string, userId: string, issuedAt: Date) =>
  createHmac("sha256", LEGACY_SECRET)
    .update(`${certificateId}:${userId}:${issuedAt.toISOString()}`)
    .digest("hex");

/** Distinct pre-cutover issue times, with milliseconds (as stored). */
const beforeCutover = (i: number) =>
  new Date(SIGNING_CUTOVER.getTime() - (i + 1) * 3_600_000 - 123);
const afterCutover = new Date(SIGNING_CUTOVER.getTime() + 3_600_000);

type Fixture = {
  issuedAt?: Date;
  status?: "PENDING_PAYMENT" | "ACTIVE" | "REVOKED";
  hash?: "legacy" | "current";
  paymentOwner?: "self" | "other" | "none";
  snapshotWpm?: number;
};

async function newUser(tag: string) {
  return db.user.create({
    data: {
      authId: randomUUID(),
      email: `resign-${tag}-${randomBytes(3).toString("hex")}@example.com`,
    },
  });
}

async function seedCertificate(certificateId: string, opts: Fixture = {}) {
  const tag = randomBytes(4).toString("hex");
  const issuedAt = opts.issuedAt ?? beforeCutover(0);
  const status = opts.status ?? "PENDING_PAYMENT";
  const user = await newUser(tag);
  const passage = await db.passage.create({
    data: { content: "resign passage", wordCount: 2, charCount: 14 },
  });
  const session = await db.testSession.create({
    data: {
      userId: user.id,
      mode: "TIMED",
      language: "ENGLISH",
      duration: 300,
      trustTier: "CERTIFICATE",
      status: "COMPLETED",
      passageId: passage.id,
      integrityToken: `resign-${tag}`,
      startedAt: new Date(issuedAt.getTime() - 400_000),
      completedAt: new Date(issuedAt.getTime() - 60_000),
      expiresAt: new Date(issuedAt.getTime() + 3_600_000),
    },
  });
  const result = await db.testResult.create({
    data: {
      sessionId: session.id,
      userId: user.id,
      shareId: `resign${tag}`,
      wpm: 31.4,
      rawWpm: 33.25,
      netWpm: 31.4,
      accuracy: 0.9105,
      correctChars: 800,
      incorrectChars: 10,
      totalChars: 810,
      correctedErrors: 0,
      uncorrectedErrors: 0,
      elapsedMs: 300_000,
      duration: 300,
      integrityStatus: "VERIFIED",
      scoringSource: "SERVER_RECONSTRUCTED",
      createdAt: new Date(issuedAt.getTime() - 60_000),
    },
  });
  const verificationHash =
    opts.hash === "current"
      ? generateVerificationHash(certificateId, user.id, issuedAt)
      : legacyHash(certificateId, user.id, issuedAt);
  const certificate = await db.certificate.create({
    data: {
      certificateId,
      verificationHash,
      userId: user.id,
      resultId: result.id,
      status,
      testType: "TIMED Typing Assessment",
      language: "ENGLISH",
      duration: 300,
      wpm: opts.snapshotWpm ?? result.netWpm,
      rawWpm: result.rawWpm,
      accuracy: result.accuracy,
      issuedAt,
      ...(status === "ACTIVE" && {
        pdfUrl: `https://storage.example/certificates/${certificateId}.pdf`,
        qrData: `http://localhost:3000/verify/${certificateId}`,
      }),
      ...(status === "REVOKED" && { revokedAt: new Date(), revokedReason: "test" }),
    },
  });
  if (opts.paymentOwner !== "none") {
    const payer = opts.paymentOwner === "other" ? await newUser(`${tag}o`) : user;
    await db.payment.create({
      data: {
        userId: payer.id,
        certificateId: certificate.id,
        orderId: `order_resign_${tag}`,
        amount: 49900,
        currency: "INR",
        idempotencyKey: `idem_resign_${tag}`,
        status: status === "PENDING_PAYMENT" ? "PENDING" : "COMPLETED",
        ...(status !== "PENDING_PAYMENT" && { paymentId: `pay_resign_${tag}` }),
      },
    });
  }
  return {
    id: certificate.id,
    certificateId,
    userId: user.id,
    issuedAt,
    verificationHash,
  };
}

type Seeded = Awaited<ReturnType<typeof seedCertificate>>;

/** The six legacy certificates as in Production: C9XGPR ACTIVE, five pending. */
async function seedLegacy(overrides: Partial<Record<string, Fixture>> = {}) {
  const seeded: Record<string, Seeded> = {};
  for (const [i, certificateId] of LEGACY_CERTIFICATE_IDS.entries()) {
    seeded[certificateId] = await seedCertificate(certificateId, {
      issuedAt: beforeCutover(i),
      status: certificateId === C9XGPR ? "ACTIVE" : "PENDING_PAYMENT",
      ...overrides[certificateId],
    });
  }
  return seeded;
}

/** Certificates outside the allowlist: one legacy pre-cutover, one current. */
async function seedControls() {
  const code = () =>
    `TF-2026-Z${randomBytes(3).toString("hex").toUpperCase().slice(0, 5)}`;
  return [
    await seedCertificate(code(), { issuedAt: beforeCutover(9), status: "ACTIVE" }),
    await seedCertificate(code(), {
      issuedAt: afterCutover,
      status: "ACTIVE",
      hash: "current",
    }),
  ];
}

async function cleanup() {
  const ids = [...LEGACY_CERTIFICATE_IDS];
  await db.auditLog.deleteMany({
    where: { resource: "Certificate", resourceId: { in: ids } },
  });
  await db.payment.deleteMany({ where: { certificate: { certificateId: { in: ids } } } });
  await db.certificate.deleteMany({ where: { certificateId: { in: ids } } });
}

beforeEach(cleanup);
afterAll(cleanup);

/** Every column of the certificates (and their payments), for before/after comparison. */
async function rows(certificateIds: readonly string[]) {
  return db.certificate.findMany({
    where: { certificateId: { in: [...certificateIds] } },
    orderBy: { certificateId: "asc" },
    include: { payment: true },
  });
}

const withoutHash = (list: Awaited<ReturnType<typeof rows>>) =>
  list.map(({ verificationHash: _hash, ...rest }) => rest);

const auditRows = (action: string) =>
  db.auditLog.findMany({
    where: {
      action,
      resource: "Certificate",
      resourceId: { in: [...LEGACY_CERTIFICATE_IDS] },
    },
    orderBy: { createdAt: "asc" },
  });

const call = (body?: string, token = CRON_SECRET) =>
  resignRoute.POST(
    new Request("http://localhost/api/cron/resign-legacy-certificates", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      ...(body !== undefined && { body }),
    })
  );

const run = async (mode?: "dry-run" | "apply" | "rollback") => {
  const res = await call(mode ? JSON.stringify({ mode }) : undefined);
  expect(res.status).toBe(200);
  return (await res.json()) as ResignSummary;
};

const ALL_SAFE = {
  otherCertificatesUnchanged: true,
  legacyCertificateFieldsUnchanged: true,
  legacyPaymentsUnchanged: true,
};

// ---------------------------------------------------------------------------

describe("dry-run (the default)", () => {
  it("reports the six legacy certificates and writes nothing", async () => {
    const legacy = await seedLegacy();
    const controls = await seedControls();
    const ids = [...LEGACY_CERTIFICATE_IDS, ...controls.map((c) => c.certificateId)];
    const before = await rows(ids);

    const res = await call(); // no body at all
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as ResignSummary;

    expect(body.mode).toBe("dry-run");
    expect(body.counts).toEqual({ would_resign: 6 });
    expect(body.certificates).toEqual(
      LEGACY_CERTIFICATE_IDS.map((certificateId) => ({
        certificateId,
        status: certificateId === C9XGPR ? "ACTIVE" : "PENDING_PAYMENT",
        outcome: "would_resign",
      }))
    );
    expect(body.safety).toEqual(ALL_SAFE);
    expect(await rows(ids)).toEqual(before);
    expect(await auditRows(RESIGN_ACTION)).toHaveLength(0);
    // Never a hash in the response.
    for (const c of Object.values(legacy)) expect(text).not.toContain(c.verificationHash);
  });
});

describe("apply", () => {
  it("re-signs exactly the six, changing verificationHash only, with one audit row each", async () => {
    const legacy = await seedLegacy();
    const controls = await seedControls();
    const before = await rows(LEGACY_CERTIFICATE_IDS);
    const controlsBefore = await rows(controls.map((c) => c.certificateId));

    const body = await run("apply");

    expect(body.counts).toEqual({ resigned: 6 });
    expect(body.safety).toEqual(ALL_SAFE);
    const after = await rows(LEGACY_CERTIFICATE_IDS);
    // Status, number, owner, issue date, result, snapshot, PDF, QR, updatedAt
    // and the payment are all identical.
    expect(withoutHash(after)).toEqual(withoutHash(before));
    for (const cert of after) {
      expect(cert.verificationHash).toBe(
        generateVerificationHash(cert.certificateId, cert.userId, cert.issuedAt)
      );
      expect(cert.verificationHash).not.toBe(
        legacy[cert.certificateId]!.verificationHash
      );
    }
    expect(await rows(controls.map((c) => c.certificateId))).toEqual(controlsBefore);

    const audit = await auditRows(RESIGN_ACTION);
    expect(audit.map((a) => a.resourceId).sort()).toEqual(
      [...LEGACY_CERTIFICATE_IDS].sort()
    );
    for (const a of audit) {
      expect(a.userId).toBeNull();
      expect(a.metadata).toEqual({
        runId: body.runId,
        oldHash: legacy[a.resourceId!]!.verificationHash,
        resignedHash: after.find((c) => c.certificateId === a.resourceId)!
          .verificationHash,
        cutover: "2026-09-26T00:21:25.000Z",
        reason: expect.stringContaining("SESSION_SECRET"),
      });
    }
  });

  it("an ACTIVE legacy certificate goes from INVALID to VERIFIED; a pending one stays pending", async () => {
    await seedLegacy();
    expect((await getCertificateVerification(C9XGPR))?.state).toBe("INVALID");
    expect((await getCertificateVerification(B64BP7J))?.state).toBe("PENDING");

    await run("apply");

    expect((await getCertificateVerification(C9XGPR))?.state).toBe("VERIFIED");
    expect((await getCertificateVerification(B64BP7J))?.state).toBe("PENDING");
    const pending = await db.certificate.findUniqueOrThrow({
      where: { certificateId: B64BP7J },
      include: { payment: true },
    });
    expect(pending.status).toBe("PENDING_PAYMENT");
    expect(pending.payment?.status).toBe("PENDING");
  });

  it("a second apply changes nothing", async () => {
    await seedLegacy();
    await run("apply");
    const before = await rows(LEGACY_CERTIFICATE_IDS);

    const again = await run("apply");

    expect(again.counts).toEqual({ already_valid: 6 });
    expect(await rows(LEGACY_CERTIFICATE_IDS)).toEqual(before);
    expect(await auditRows(RESIGN_ACTION)).toHaveLength(6);
  });

  it("concurrent applies converge: each certificate is re-signed and audited once", async () => {
    await seedLegacy();

    const [a, b] = await Promise.all([
      resignLegacyCertificates("apply"),
      resignLegacyCertificates("apply"),
    ]);

    expect((a.counts.resigned ?? 0) + (b.counts.resigned ?? 0)).toBe(6);
    expect((a.counts.already_valid ?? 0) + (b.counts.already_valid ?? 0)).toBe(6);
    const audit = await auditRows(RESIGN_ACTION);
    expect(new Set(audit.map((x) => x.resourceId)).size).toBe(6);
    expect(audit).toHaveLength(6);
    for (const cert of await rows(LEGACY_CERTIFICATE_IDS)) {
      expect(cert.verificationHash).toBe(
        generateVerificationHash(cert.certificateId, cert.userId, cert.issuedAt)
      );
    }
  });

  it("skips post-cutover, revoked, invariant-breaking and already-valid certificates", async () => {
    const legacy = await seedLegacy({
      [B64BP7J]: { issuedAt: afterCutover },
      [LR88NY]: { status: "REVOKED" },
      [AREJKD]: { paymentOwner: "other" },
      [TVY3N3]: { snapshotWpm: 99 },
      [PT8BB9]: { hash: "current" },
    });

    const body = await run("apply");

    expect(body.counts).toEqual({
      resigned: 1,
      skipped_after_cutover: 1,
      skipped_revoked: 1,
      skipped_invariant: 2,
      already_valid: 1,
    });
    const outcome = (id: string) =>
      body.certificates.find((c) => c.certificateId === id)?.outcome;
    expect(outcome(C9XGPR)).toBe("resigned");
    expect(outcome(B64BP7J)).toBe("skipped_after_cutover");
    expect(outcome(LR88NY)).toBe("skipped_revoked");
    expect(outcome(AREJKD)).toBe("skipped_invariant");
    expect(outcome(TVY3N3)).toBe("skipped_invariant");
    expect(outcome(PT8BB9)).toBe("already_valid");
    for (const id of [B64BP7J, LR88NY, AREJKD, TVY3N3, PT8BB9]) {
      const cert = await db.certificate.findUniqueOrThrow({
        where: { certificateId: id },
      });
      expect(cert.verificationHash).toBe(legacy[id]!.verificationHash);
    }
    expect(await auditRows(RESIGN_ACTION)).toHaveLength(1);
  });

  it("a certificate without its payment, or missing entirely, is not re-signed", async () => {
    await seedLegacy({
      [AREJKD]: { paymentOwner: "none" },
      [PT8BB9]: { paymentOwner: "none" },
    });
    await db.certificate.delete({ where: { certificateId: PT8BB9 } });

    const body = await run("apply");

    expect(body.counts).toEqual({ resigned: 4, skipped_invariant: 1, not_found: 1 });
    expect(body.certificates.find((c) => c.certificateId === PT8BB9)).toEqual({
      certificateId: PT8BB9,
      status: null,
      outcome: "not_found",
    });
  });

  it("never logs a hash", async () => {
    const legacy = await seedLegacy();
    const lines: string[] = [];
    const keep = (chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    };
    const spies = [
      vi.spyOn(process.stdout, "write").mockImplementation(keep),
      vi.spyOn(process.stderr, "write").mockImplementation(keep),
      ...(["log", "info", "warn", "error", "debug"] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          lines.push(args.map(String).join(" "));
        })
      ),
    ];
    try {
      await run("apply");
      await run("rollback");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    const logs = lines.join("\n");
    expect(logs).toContain("Legacy certificate re-sign run");
    for (const cert of await rows(LEGACY_CERTIFICATE_IDS)) {
      expect(logs).not.toContain(cert.verificationHash);
      expect(logs).not.toContain(
        generateVerificationHash(cert.certificateId, cert.userId, cert.issuedAt)
      );
      expect(logs).not.toContain(legacy[cert.certificateId]!.verificationHash);
    }
  });
});

describe("rollback", () => {
  it("restores the audited old hashes, only where the re-signed hash is still in place, idempotently", async () => {
    const legacy = await seedLegacy();
    const before = await rows(LEGACY_CERTIFICATE_IDS);
    await run("apply");
    // Someone changed one certificate's hash after the re-sign: leave it alone.
    const tampered = "f".repeat(64);
    await db.$executeRaw`UPDATE certificates SET "verificationHash" = ${tampered} WHERE "certificateId" = ${TVY3N3}`;

    const body = await run("rollback");

    expect(body.counts).toEqual({ rolled_back: 5, not_resigned: 1 });
    expect(body.safety).toEqual(ALL_SAFE);
    for (const cert of await rows(LEGACY_CERTIFICATE_IDS)) {
      expect(cert.verificationHash).toBe(
        cert.certificateId === TVY3N3
          ? tampered
          : legacy[cert.certificateId]!.verificationHash
      );
    }
    expect(withoutHash(await rows(LEGACY_CERTIFICATE_IDS))).toEqual(withoutHash(before));
    const rolledBack = await auditRows(RESIGN_ROLLBACK_ACTION);
    expect(rolledBack).toHaveLength(5);
    const resignRunId = (await auditRows(RESIGN_ACTION))[0]!.metadata as {
      runId: string;
    };
    for (const a of rolledBack) {
      expect(a.metadata).toMatchObject({
        runId: body.runId,
        resignRunId: resignRunId.runId,
      });
    }

    const again = await run("rollback");
    expect(again.counts).toEqual({ not_resigned: 6 });
    expect(await auditRows(RESIGN_ROLLBACK_ACTION)).toHaveLength(5);
  });

  it("does nothing for certificates that were never re-signed", async () => {
    const legacy = await seedLegacy();
    const body = await run("rollback");
    expect(body.counts).toEqual({ not_resigned: 6 });
    for (const cert of await rows(LEGACY_CERTIFICATE_IDS)) {
      expect(cert.verificationHash).toBe(legacy[cert.certificateId]!.verificationHash);
    }
  });

  it("apply after a rollback re-signs again, and the next rollback uses the latest record", async () => {
    const legacy = await seedLegacy();
    await run("apply");
    await run("rollback");
    const second = await run("apply");
    expect(second.counts).toEqual({ resigned: 6 });

    expect((await run("rollback")).counts).toEqual({ rolled_back: 6 });
    for (const cert of await rows(LEGACY_CERTIFICATE_IDS)) {
      expect(cert.verificationHash).toBe(legacy[cert.certificateId]!.verificationHash);
    }
  });
});

describe("route", () => {
  it("is POST only", () => {
    expect(Object.keys(resignRoute)).not.toContain("GET");
  });

  it("401 for a wrong token, 503 without a usable CRON_SECRET, and nothing runs", async () => {
    await seedLegacy();
    expect((await call(JSON.stringify({ mode: "apply" }), "wrong")).status).toBe(401);

    vi.stubEnv("CRON_SECRET", "too-short");
    __clearServerEnvForTesting();
    try {
      expect((await call(JSON.stringify({ mode: "apply" }))).status).toBe(503);
    } finally {
      vi.stubEnv("CRON_SECRET", CRON_SECRET);
      __clearServerEnvForTesting();
    }
    expect(await auditRows(RESIGN_ACTION)).toHaveLength(0);
  });

  it.each([
    [
      "certificate ids",
      JSON.stringify({ mode: "apply", certificateIds: ["TF-2026-ZZZZZZ"] }),
    ],
    ["an unknown mode", JSON.stringify({ mode: "force" })],
    ["invalid JSON", "{mode:"],
    ["a JSON array", "[]"],
  ])("400 for %s, and nothing runs", async (_name, body) => {
    await seedLegacy();
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(await auditRows(RESIGN_ACTION)).toHaveLength(0);
  });
});

describe("othersUnchanged", () => {
  const row = (id: string, updatedAt: number, digest: string) => ({
    id,
    updatedAt,
    digest,
  });

  it("flags a row whose data changed while updatedAt did not (a raw write)", () => {
    const before = new Map([["a", row("a", 1, "x")]]);
    expect(othersUnchanged(before, new Map([["a", row("a", 1, "y")]]))).toBe(false);
  });

  it("ignores ordinary application updates and new rows", () => {
    const before = new Map([["a", row("a", 1, "x")]]);
    const after = new Map([
      ["a", row("a", 2, "y")],
      ["b", row("b", 3, "z")],
    ]);
    expect(othersUnchanged(before, after)).toBe(true);
  });
});
