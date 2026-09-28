/**
 * One-off TF-2026-C9XGPR QR repair (Phase 6, F1) against real Postgres.
 *
 * Storage is the in-memory fake; Prisma, the transaction, the row lock and the
 * compare-and-set are real. The runtime is made to look like a production
 * deployment on typeflow-dusky.vercel.app (fake secrets only). The certificate
 * id is fixed, so each test first moves any earlier TF-2026-C9XGPR row aside.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash, randomBytes, randomUUID } from "crypto";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { autoImplementMethods } from "next/dist/server/route-modules/app-route/helpers/auto-implement-methods";
import type { AppRouteHandlers } from "next/dist/server/route-modules/app-route/module";
import { HTTP_METHODS } from "next/dist/server/web/http";
import { db } from "@/server/db";
import { __clearServerEnvForTesting } from "@/lib/env";
import {
  certificateRecipientName,
  generateVerificationHash,
  renderCertificatePdf,
} from "@/server/services/certificate.service";
import {
  QR_REPAIR,
  QrRepairError,
  repairCertificateQr,
} from "@/server/services/certificateQrRepair.service";
import * as route from "@/app/api/cron/repair-certificate-qr/route";
import { certificateStorage } from "../setup/fakeCertificateStorage";

vi.mock("@/lib/supabase/server", async () => {
  const { fakeSupabaseServer } = await import("../setup/fakeCertificateStorage");
  return fakeSupabaseServer;
});

const SECRET = "test-only-cron-secret-0123456789abcdef";
const OTHER_QR = "https://someone-else.example.test/verify/TF-2026-C9XGPR";
const PDF_URL = `https://storage.test/${QR_REPAIR.bucket}/${QR_REPAIR.storagePath}`;
const ISSUED_AT = new Date("2026-09-25T22:23:30.793Z");

/** A production deployment on the production domain (fake values). */
const ENV: Record<string, string | undefined> = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "test-only-supabase-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-supabase-service-role-key",
  RAZORPAY_KEY_ID: "rzp_test_placeholder",
  RAZORPAY_KEY_SECRET: "test-only-razorpay-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "test-only-razorpay-webhook-secret",
  SESSION_SECRET: "test-only-session-secret-not-for-production",
  CERTIFICATE_SIGNING_SECRET: "test-only-certificate-signing-secret-not-for-production",
  APP_URL: "https://typeflow-dusky.vercel.app",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_PRODUCTION_URL: "typeflow-dusky.vercel.app",
  CRON_SECRET: SECRET,
};

function setEnv(overrides: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ ...ENV, ...overrides })) {
    vi.stubEnv(key, value);
  }
  __clearServerEnvForTesting();
}

beforeAll(() => setEnv());
afterAll(() => {
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});

beforeEach(() => {
  setEnv();
  certificateStorage.objects.clear();
  certificateStorage.uploadCounts.clear();
  certificateStorage.failNext = 0;
  certificateStorage.failDownloadNext = 0;
  certificateStorage.gate = null;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type SeedOptions = {
  status?: "ACTIVE" | "REVOKED";
  payment?: "COMPLETED" | "REFUNDED";
  qrData?: string;
  pdfUrl?: string;
  badHash?: boolean;
  certificateId?: string;
};

/** Moves any earlier row with the fixed id aside and removes its repair audit rows. */
async function freeCertificateId() {
  const aside = `TF-ZZ-${randomBytes(3).toString("hex").toUpperCase()}`;
  await db.$executeRaw`UPDATE certificates SET "certificateId" = ${aside} WHERE "certificateId" = ${QR_REPAIR.certificateId}`;
  await db.auditLog.deleteMany({
    where: { resourceId: QR_REPAIR.certificateId, action: QR_REPAIR.auditAction },
  });
}

async function seed(opts: SeedOptions = {}) {
  const tag = randomBytes(4).toString("hex");
  const certificateId = opts.certificateId ?? QR_REPAIR.certificateId;
  const user = await db.user.create({
    data: {
      authId: randomUUID(),
      email: `qr-repair-${tag}@example.com`,
      displayName: "Legacy Typist",
      leaderboardOptOut: true,
    },
  });
  const passage = await db.passage.create({
    data: { content: "qr repair passage", wordCount: 3, charCount: 17 },
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
      integrityToken: `qr-${tag}`,
      startedAt: new Date(Date.now() - 300_000),
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const result = await db.testResult.create({
    data: {
      sessionId: session.id,
      userId: user.id,
      shareId: `qr${tag}`,
      wpm: 62,
      rawWpm: 64,
      netWpm: 62,
      accuracy: 0.976,
      correctChars: 1550,
      incorrectChars: 0,
      totalChars: 1550,
      correctedErrors: 0,
      uncorrectedErrors: 0,
      elapsedMs: 300_000,
      duration: 300,
      integrityStatus: "VERIFIED",
      scoringSource: "SERVER_RECONSTRUCTED",
    },
  });
  const cert = await db.certificate.create({
    data: {
      certificateId,
      verificationHash: opts.badHash
        ? "0".repeat(64)
        : generateVerificationHash(certificateId, user.id, ISSUED_AT),
      userId: user.id,
      resultId: result.id,
      status: opts.status ?? "ACTIVE",
      testType: "TIMED Typing Assessment",
      language: "ENGLISH",
      duration: 300,
      wpm: 62,
      rawWpm: 64,
      accuracy: 0.976,
      issuedAt: ISSUED_AT,
      qrData: opts.qrData ?? QR_REPAIR.oldQrData,
      pdfUrl: opts.pdfUrl ?? PDF_URL,
    },
  });
  await db.payment.create({
    data: {
      userId: user.id,
      certificateId: cert.id,
      orderId: `order_qr_${tag}`,
      paymentId: `pay_qr_${tag}`,
      amount: 49900,
      currency: "INR",
      idempotencyKey: `idem_qr_${tag}`,
      status: opts.payment ?? "COMPLETED",
    },
  });
  // The stored PDF as it was fulfilled: rendered with the old URL.
  const oldBytes = await renderCertificatePdf(
    { ...cert, recipientName: certificateRecipientName(user.displayName) },
    QR_REPAIR.oldQrData
  );
  if (certificateId === QR_REPAIR.certificateId) {
    certificateStorage.objects.set(QR_REPAIR.storagePath, oldBytes);
  }
  return { cert, user, oldBytes };
}

/** Everything the repair must not change, plus what it may. */
async function snapshot(certificateRowId: string) {
  const [certificate, payment, audit] = await Promise.all([
    db.certificate.findUniqueOrThrow({ where: { id: certificateRowId } }),
    db.payment.findUniqueOrThrow({
      where: { certificateId: certificateRowId },
      include: { paymentEvents: true },
    }),
    db.auditLog.findMany({
      where: { resourceId: QR_REPAIR.certificateId, action: QR_REPAIR.auditAction },
    }),
  ]);
  return { certificate, payment, audit };
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const stored = () => certificateStorage.objects.get(QR_REPAIR.storagePath);
const uploads = () => certificateStorage.uploadCounts.get(QR_REPAIR.storagePath) ?? 0;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Decoded first-page content, lower-cased; standard-font text is drawn as hex. */
async function pageContent(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(0).node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  return streams
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"))
    .join("")
    .toLowerCase();
}
const shows = (content: string, text: string) =>
  content.includes(Buffer.from(text, "latin1").toString("hex"));

type Handler = (req: Request) => Response | Promise<Response>;
const served = autoImplementMethods(
  route as unknown as AppRouteHandlers
) as unknown as Record<(typeof HTTP_METHODS)[number], Handler>;
/** `authorization: null` sends no header; omitted sends the correct token. */
const call = (
  query: string,
  opts: { method?: string; authorization?: string | null } = {}
) => {
  const method = opts.method ?? "POST";
  const authorization =
    opts.authorization === undefined ? `Bearer ${SECRET}` : opts.authorization;
  return served[method as (typeof HTTP_METHODS)[number]](
    new Request(`http://localhost/api/cron/repair-certificate-qr${query}`, {
      method,
      headers: authorization === null ? {} : { authorization },
    })
  );
};

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

describe("access: secret, query and methods", () => {
  it("exports POST only", () => {
    const methods = Object.keys(route).filter((k) =>
      (HTTP_METHODS as readonly string[]).includes(k)
    );
    expect(methods).toEqual(["POST"]);
  });

  it("503 without a usable CRON_SECRET, 401 with a missing or wrong token; nothing written", async () => {
    await freeCertificateId();
    const { cert } = await seed();
    const before = await snapshot(cert.id);

    for (const value of [undefined, "too-short"]) {
      setEnv({ CRON_SECRET: value });
      expect((await call("?dryRun=0")).status).toBe(503);
    }
    setEnv();
    for (const authorization of [null, "Bearer wrong-secret-0123456789abcdefghij"]) {
      expect((await call("?dryRun=0", { authorization })).status).toBe(401);
    }
    expect(uploads()).toBe(0);
    expect(await snapshot(cert.id)).toEqual(before);
  });

  it.each([
    "",
    "?dryRun=true",
    "?dryRun=",
    "?dryRun=1&dryRun=1",
    "?dryRun=0&dryRun=1",
    "?dryrun=0",
    "?dryRun=0&force=1",
  ])("400 for the query %j; nothing written", async (query) => {
    await freeCertificateId();
    const { cert } = await seed();
    const before = await snapshot(cert.id);
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(uploads()).toBe(0);
    expect(await snapshot(cert.id)).toEqual(before);
  });

  it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE"])(
    "%s is 405 and runs nothing",
    async (method) => {
      await freeCertificateId();
      const { cert } = await seed();
      const before = await snapshot(cert.id);
      expect((await call("?dryRun=0", { method })).status).toBe(405);
      expect(uploads()).toBe(0);
      expect(await snapshot(cert.id)).toEqual(before);
    }
  );
});

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

describe("dry run", () => {
  it("checks and renders in memory, reports the replacement, and writes nothing", async () => {
    await freeCertificateId();
    const { cert, user, oldBytes } = await seed();
    const before = await snapshot(cert.id);

    const res = await call("?dryRun=1");
    expect(res.status).toBe(200);
    const expected = await renderCertificatePdf(
      { ...cert, recipientName: certificateRecipientName(user.displayName) },
      QR_REPAIR.newQrData
    );
    expect(await res.json()).toEqual({
      outcome: "dry_run",
      newQrData: "https://typeflow-dusky.vercel.app/verify/TF-2026-C9XGPR",
      currentPdf: {
        size: oldBytes.length,
        sha256: sha256(oldBytes),
        reproducibleFromOldUrl: true,
      },
      replacementPdf: { size: expected.length, sha256: sha256(expected) },
    });
    expect(uploads()).toBe(0);
    expect(stored()).toEqual(oldBytes);
    expect(await snapshot(cert.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Preconditions (both modes): 409, nothing written
// ---------------------------------------------------------------------------

describe("preconditions", () => {
  const cases: Array<{
    name: string;
    reason: string;
    seed?: SeedOptions | null;
    env?: Record<string, string | undefined>;
  }> = [
    {
      name: "not a production deployment",
      reason: "not_production",
      env: { VERCEL_ENV: undefined },
    },
    { name: "certificate not found", reason: "not_found", seed: null },
    {
      name: "certificate not ACTIVE",
      reason: "status_not_active",
      seed: { status: "REVOKED" },
    },
    {
      name: "payment not COMPLETED",
      reason: "payment_not_completed",
      seed: { payment: "REFUNDED" },
    },
    {
      name: "verification hash invalid",
      reason: "verification_hash_invalid",
      seed: { badHash: true },
    },
    {
      name: "qrData not the old Preview URL",
      reason: "qr_data_unexpected",
      seed: { qrData: OTHER_QR },
    },
    {
      name: "pdfUrl not the canonical path",
      reason: "pdf_url_unexpected",
      seed: { pdfUrl: "https://storage.test/certificates/certificates/other.pdf" },
    },
    {
      name: "APP_URL not the production domain",
      reason: "app_url_not_production",
      env: { APP_URL: "https://typeflow-git-some-branch.example-preview.test" },
    },
    {
      name: "replacement URL not the expected one",
      reason: "replacement_url_unexpected",
      env: {
        APP_URL: "https://typeflow.example.test",
        VERCEL_PROJECT_PRODUCTION_URL: "typeflow.example.test",
      },
    },
  ];

  for (const c of cases) {
    for (const query of ["?dryRun=1", "?dryRun=0"]) {
      it(`${c.name} → 409 ${c.reason} (${query}), nothing written`, async () => {
        await freeCertificateId();
        const seeded = c.seed === null ? null : await seed(c.seed ?? {});
        const before = seeded ? await snapshot(seeded.cert.id) : null;
        setEnv(c.env ?? {});

        const res = await call(query);
        expect(res.status).toBe(409);
        const body = (await res.json()) as { outcome: string; failed: string[] };
        expect(body.outcome).toBe("precondition_failed");
        expect(body.failed).toContain(c.reason);
        expect(uploads()).toBe(0);
        if (seeded) {
          expect(stored()).toEqual(seeded.oldBytes);
          expect(await snapshot(seeded.cert.id)).toEqual(before);
        }
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

describe("apply", () => {
  it("repairs exactly this certificate: new PDF at the same path, qrData, one audit row; nothing else changes", async () => {
    await freeCertificateId();
    const other = await seed({
      certificateId: `TF-QR-${randomBytes(3).toString("hex").toUpperCase()}`,
    });
    const otherBefore = await db.certificate.findUniqueOrThrow({
      where: { id: other.cert.id },
    });
    const { cert, user, oldBytes } = await seed();
    const before = await snapshot(cert.id);

    const res = await call("?dryRun=0");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ outcome: "repaired", newQrData: QR_REPAIR.newQrData });

    // PDF: same path, exactly the deterministic render for the new URL.
    const expected = await renderCertificatePdf(
      { ...cert, recipientName: certificateRecipientName(user.displayName) },
      QR_REPAIR.newQrData
    );
    const bytes = stored()!;
    expect(uploads()).toBe(1);
    expect(bytes).toEqual(expected);
    const content = await pageContent(bytes);
    expect(shows(content, `Verify: ${QR_REPAIR.newQrData}`)).toBe(true);
    expect(shows(content, QR_REPAIR.oldHost)).toBe(false);
    expect(shows(await pageContent(oldBytes), QR_REPAIR.oldHost)).toBe(true);

    // Database: only qrData (and updatedAt) changed; payment and events untouched.
    const after = await snapshot(cert.id);
    const { qrData, updatedAt: _u1, ...rest } = after.certificate;
    const { qrData: oldQr, updatedAt: _u0, ...restBefore } = before.certificate;
    expect(oldQr).toBe(QR_REPAIR.oldQrData);
    expect(qrData).toBe(QR_REPAIR.newQrData);
    expect(rest).toEqual(restBefore);
    expect(after.payment).toEqual(before.payment);
    expect(
      await db.certificate.findUniqueOrThrow({ where: { id: other.cert.id } })
    ).toEqual(otherBefore);

    // One audit row; its metadata restores the exact old PDF (rollback).
    expect(after.audit).toHaveLength(1);
    const meta = after.audit[0]!.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      oldQrData: QR_REPAIR.oldQrData,
      newQrData: QR_REPAIR.newQrData,
      storagePath: QR_REPAIR.storagePath,
      oldPdfSha256: sha256(oldBytes),
      newPdfSha256: sha256(expected),
    });
    const backup = Buffer.from(meta.oldPdfBase64 as string, "base64");
    expect(sha256(backup)).toBe(meta.oldPdfSha256);
  });

  it("a second apply does nothing", async () => {
    await freeCertificateId();
    const { cert } = await seed();
    expect((await repairCertificateQr({ dryRun: false })).outcome).toBe("repaired");
    const after = await snapshot(cert.id);
    const bytes = stored();

    expect(await repairCertificateQr({ dryRun: false })).toEqual({
      outcome: "already_repaired",
    });
    expect(await (await call("?dryRun=1")).json()).toEqual({
      outcome: "already_repaired",
    });
    expect(uploads()).toBe(1);
    expect(stored()).toBe(bytes);
    expect(await snapshot(cert.id)).toEqual(after);
  });

  it("two concurrent applies converge: one repairs, the other finds it repaired", async () => {
    await freeCertificateId();
    const { cert } = await seed();
    const results = await Promise.all([
      repairCertificateQr({ dryRun: false }),
      repairCertificateQr({ dryRun: false }),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual([
      "already_repaired",
      "repaired",
    ]);
    expect(uploads()).toBe(1);
    const after = await snapshot(cert.id);
    expect(after.certificate.qrData).toBe(QR_REPAIR.newQrData);
    expect(after.audit).toHaveLength(1);
  });

  it("row lock, writer first: the repair waits, then sees the changed qrData and touches nothing", async () => {
    await freeCertificateId();
    const { cert, oldBytes } = await seed();
    let lockTaken!: () => void;
    const locked = new Promise<void>((resolve) => (lockTaken = resolve));
    let commit!: () => void;
    const mayCommit = new Promise<void>((resolve) => (commit = resolve));

    const writer = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM certificates WHERE id = ${cert.id}::uuid FOR UPDATE`;
        lockTaken();
        await mayCommit;
        await tx.certificate.update({
          where: { id: cert.id },
          data: { qrData: OTHER_QR },
        });
      },
      { timeout: 20_000 }
    );
    await locked;
    let settled = false;
    const repair = repairCertificateQr({ dryRun: false }).finally(() => {
      settled = true;
    });
    await pause(300);
    expect(settled).toBe(false); // blocked on the row lock
    expect(uploads()).toBe(0);

    commit();
    await writer;
    expect(await repair).toEqual({
      outcome: "precondition_failed",
      failed: ["qr_data_unexpected"],
    });
    expect(uploads()).toBe(0);
    expect(stored()).toEqual(oldBytes);
    expect((await snapshot(cert.id)).audit).toHaveLength(0);
  });

  it("row lock, repair first: a concurrent compare-and-set writer waits and then finds nothing to change", async () => {
    await freeCertificateId();
    const { cert } = await seed();
    const held = certificateStorage.hold(); // pauses the repair mid-upload, lock held
    const repair = repairCertificateQr({ dryRun: false });
    await held.reached;

    let writerDone = false;
    const writer = db.certificate
      .updateMany({
        where: { id: cert.id, qrData: QR_REPAIR.oldQrData },
        data: { qrData: OTHER_QR },
      })
      .finally(() => {
        writerDone = true;
      });
    await pause(300);
    expect(writerDone).toBe(false); // blocked on the row lock

    held.release();
    expect((await repair).outcome).toBe("repaired");
    expect((await writer).count).toBe(0);
    const after = await snapshot(cert.id);
    expect(after.certificate.qrData).toBe(QR_REPAIR.newQrData);
    expect(shows(await pageContent(stored()!), `Verify: ${QR_REPAIR.newQrData}`)).toBe(
      true
    );
  });

  it("upload failure: the database is unchanged and the old PDF is put back", async () => {
    await freeCertificateId();
    const { cert, oldBytes } = await seed();
    const before = await snapshot(cert.id);
    certificateStorage.failNext = 1;

    const res = await call("?dryRun=0");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ pdfRestored: true });
    expect(uploads()).toBe(2); // the failed replacement, then the old bytes
    expect(stored()).toEqual(oldBytes);
    expect(await snapshot(cert.id)).toEqual(before);
  });

  it("cannot read the current PDF: aborts before any upload", async () => {
    await freeCertificateId();
    const { cert, oldBytes } = await seed();
    const before = await snapshot(cert.id);
    certificateStorage.failDownloadNext = 1;

    await expect(repairCertificateQr({ dryRun: false })).rejects.toMatchObject({
      name: "QrRepairError",
      pdfRestored: null,
    });
    expect(uploads()).toBe(0);
    expect(stored()).toEqual(oldBytes);
    expect(await snapshot(cert.id)).toEqual(before);
  });

  it("transaction failure after the upload: rolled back, and the old PDF is put back", async () => {
    await freeCertificateId();
    const { cert, oldBytes } = await seed();
    const before = await snapshot(cert.id);
    // Injected failure: the audit insert raises inside the transaction.
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION f1_test_fail_repair_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = '${QR_REPAIR.auditAction}' THEN
          RAISE EXCEPTION 'injected failure (test)';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER f1_test_fail_repair_audit BEFORE INSERT ON audit_logs
       FOR EACH ROW EXECUTE FUNCTION f1_test_fail_repair_audit()`
    );
    try {
      const error = await repairCertificateQr({ dryRun: false }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(QrRepairError);
      expect((error as QrRepairError).pdfRestored).toBe(true);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS f1_test_fail_repair_audit ON audit_logs`
      );
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS f1_test_fail_repair_audit()`);
    }
    expect(uploads()).toBe(2);
    expect(stored()).toEqual(oldBytes);
    expect(await snapshot(cert.id)).toEqual(before);
  });
});
