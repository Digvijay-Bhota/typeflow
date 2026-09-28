/**
 * ONE-OFF MAINTENANCE (Phase 5C-9): re-sign the legacy certificates.
 *
 * Until the signing cutover (2026-09-26T00:21:25Z, deployment e0a6383),
 * Production hashed certificates with SESSION_SECRET. Verification now uses
 * CERTIFICATE_SIGNING_SECRET, so the six certificates issued before it can
 * never verify: an ACTIVE one shows "could not be verified". The old
 * SESSION_SECRET value has since been replaced and cannot be recovered.
 *
 * This recomputes their verificationHash with generateVerificationHash, from
 * the row's own certificateId, userId and issuedAt (the hash inputs are
 * unchanged since the cutover; only the secret changed). Nothing else about a
 * certificate changes: its number, owner, result, issue date, status, PDF and
 * QR code stay as they are, so its public URL keeps working.
 *
 * Safety:
 *  - Only the hard-coded ids, only if issued before the cutover, never a
 *    REVOKED one, and only if the owner, result and payment agree and the
 *    score snapshot equals the result (checked again under a row lock).
 *  - A hash that already verifies is left alone ("already_valid"), so a
 *    repeated or concurrent run changes nothing more.
 *  - The update is raw SQL that sets verificationHash only, as a
 *    compare-and-set against the hash that was read, in one transaction with
 *    its audit_logs row (CERTIFICATE_RESIGNED), which keeps the old hash for
 *    rollback. Hashes are never logged or returned.
 *  - Rollback restores the audited old hash only if the certificate still
 *    carries exactly the hash this operation wrote.
 *  - Every run checks that no other certificate and none of these
 *    certificates' payments or other fields changed.
 *
 * REMOVE this service, its route (/api/cron/resign-legacy-certificates), its
 * schema and its tests once the Production run is done and verified; keep the
 * audit_logs rows.
 */
import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { logger } from "@/lib/logger";
import {
  generateVerificationHash,
  hasValidVerificationHash,
} from "./certificate.service";

/** The certificates issued in Production before the cutover (all six). */
export const LEGACY_CERTIFICATE_IDS = [
  "TF-2026-C9XGPR",
  "TF-2026-64BP7J",
  "TF-2026-LR88NY",
  "TF-2026-AREJKD",
  "TF-2026-TVY3N3",
  "TF-2026-PT8BB9",
] as const;

/** When Production started signing with CERTIFICATE_SIGNING_SECRET. */
export const SIGNING_CUTOVER = new Date("2026-09-26T00:21:25Z");

export const RESIGN_ACTION = "CERTIFICATE_RESIGNED";
export const RESIGN_ROLLBACK_ACTION = "CERTIFICATE_RESIGN_ROLLED_BACK";
const AUDIT_RESOURCE = "Certificate";
const REASON =
  "Issued before the signing cutover: hashed with the old SESSION_SECRET, not CERTIFICATE_SIGNING_SECRET";

export type ResignMode = "dry-run" | "apply" | "rollback";

export type ResignOutcome =
  | "not_found"
  | "skipped_after_cutover"
  | "skipped_revoked"
  | "skipped_invariant"
  | "already_valid"
  | "would_resign"
  | "resigned"
  | "rolled_back"
  | "not_resigned"
  | "conflict";

export type ResignSummary = {
  mode: ResignMode;
  runId: string;
  counts: Partial<Record<ResignOutcome, number>>;
  certificates: {
    certificateId: string;
    status: string | null;
    outcome: ResignOutcome;
  }[];
  safety: {
    /** No other certificate was changed by this run. */
    otherCertificatesUnchanged: boolean;
    /** These certificates changed in verificationHash only (if at all). */
    legacyCertificateFieldsUnchanged: boolean;
    /** Their payments did not change. */
    legacyPaymentsUnchanged: boolean;
  };
};

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

const candidateSelect = {
  id: true,
  certificateId: true,
  userId: true,
  issuedAt: true,
  verificationHash: true,
  status: true,
  wpm: true,
  rawWpm: true,
  accuracy: true,
  result: {
    select: { userId: true, netWpm: true, rawWpm: true, accuracy: true, createdAt: true },
  },
  payment: { select: { userId: true } },
} satisfies Prisma.CertificateSelect;

type Candidate = Prisma.CertificateGetPayload<{ select: typeof candidateSelect }>;

/** Owner, result, payment and score snapshot agree, as issuance left them. */
function invariantsHold(cert: Candidate): boolean {
  const { result, payment } = cert;
  return (
    payment !== null &&
    result.userId === cert.userId &&
    payment.userId === cert.userId &&
    result.createdAt.getTime() <= cert.issuedAt.getTime() &&
    cert.wpm === result.netWpm &&
    cert.rawWpm === result.rawWpm &&
    cert.accuracy === result.accuracy
  );
}

/** Why a certificate must not be re-signed, or null if it should be. */
function skipReason(cert: Candidate | null): ResignOutcome | null {
  if (!cert) return "not_found";
  if (cert.issuedAt.getTime() >= SIGNING_CUTOVER.getTime())
    return "skipped_after_cutover";
  if (cert.status === "REVOKED") return "skipped_revoked";
  if (!invariantsHold(cert)) return "skipped_invariant";
  if (hasValidVerificationHash(cert)) return "already_valid";
  return null;
}

type Result = { certificateId: string; status: string | null; outcome: ResignOutcome };

/** Locks the certificate row for the rest of the transaction; its id, or null. */
async function lockCertificate(
  tx: Prisma.TransactionClient,
  certificateId: string
): Promise<string | null> {
  const found = await tx.certificate.findUnique({
    where: { certificateId },
    select: { id: true },
  });
  if (!found) return null;
  await tx.$executeRaw`SELECT id FROM certificates WHERE id = ${found.id}::uuid FOR UPDATE`;
  return found.id;
}

/** Sets verificationHash only (not updatedAt) if it still equals `expected`. */
function swapHash(
  tx: Prisma.TransactionClient,
  id: string,
  expected: string,
  next: string
): Promise<number> {
  return tx.$executeRaw`UPDATE certificates SET "verificationHash" = ${next}
    WHERE id = ${id}::uuid AND "verificationHash" = ${expected}`;
}

async function evaluate(certificateId: string): Promise<Result> {
  const cert = await db.certificate.findUnique({
    where: { certificateId },
    select: candidateSelect,
  });
  return {
    certificateId,
    status: cert?.status ?? null,
    outcome: skipReason(cert) ?? "would_resign",
  };
}

async function resign(certificateId: string, runId: string): Promise<Result> {
  return db.$transaction(async (tx) => {
    const id = await lockCertificate(tx, certificateId);
    // Re-read under the lock: a concurrent run may have re-signed it already.
    const cert = id
      ? await tx.certificate.findUnique({ where: { id }, select: candidateSelect })
      : null;
    const status = cert?.status ?? null;
    const skip = skipReason(cert);
    if (skip || !cert) return { certificateId, status, outcome: skip ?? "not_found" };

    const resignedHash = generateVerificationHash(
      cert.certificateId,
      cert.userId,
      cert.issuedAt
    );
    if ((await swapHash(tx, cert.id, cert.verificationHash, resignedHash)) !== 1) {
      return { certificateId, status, outcome: "conflict" };
    }
    await tx.auditLog.create({
      data: {
        action: RESIGN_ACTION,
        resource: AUDIT_RESOURCE,
        resourceId: cert.certificateId,
        metadata: {
          runId,
          oldHash: cert.verificationHash,
          resignedHash,
          cutover: SIGNING_CUTOVER.toISOString(),
          reason: REASON,
        },
      },
    });
    return { certificateId, status, outcome: "resigned" };
  });
}

const HEX_HASH = z.string().regex(/^[0-9a-f]{64}$/);
const resignRecordSchema = z.object({
  runId: z.string(),
  oldHash: HEX_HASH,
  resignedHash: HEX_HASH,
});

async function rollback(certificateId: string, runId: string): Promise<Result> {
  return db.$transaction(async (tx) => {
    const id = await lockCertificate(tx, certificateId);
    const cert = id
      ? await tx.certificate.findUnique({
          where: { id },
          select: { id: true, status: true, verificationHash: true },
        })
      : null;
    if (!cert) return { certificateId, status: null, outcome: "not_found" };

    // The most recent re-sign of this certificate is the source of truth.
    const record = await tx.auditLog.findFirst({
      where: {
        action: RESIGN_ACTION,
        resource: AUDIT_RESOURCE,
        resourceId: certificateId,
      },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    const parsed = resignRecordSchema.safeParse(record?.metadata);
    // Nothing to undo: never re-signed, already rolled back, or changed since.
    if (!parsed.success || cert.verificationHash !== parsed.data.resignedHash) {
      return { certificateId, status: cert.status, outcome: "not_resigned" };
    }

    const { oldHash, resignedHash, runId: resignRunId } = parsed.data;
    if ((await swapHash(tx, cert.id, resignedHash, oldHash)) !== 1) {
      return { certificateId, status: cert.status, outcome: "conflict" };
    }
    await tx.auditLog.create({
      data: {
        action: RESIGN_ROLLBACK_ACTION,
        resource: AUDIT_RESOURCE,
        resourceId: certificateId,
        metadata: {
          runId,
          resignRunId,
          cutover: SIGNING_CUTOVER.toISOString(),
          reason: "Rollback of the legacy re-sign",
        },
      },
    });
    return { certificateId, status: cert.status, outcome: "rolled_back" };
  });
}

// ---------------------------------------------------------------------------
// Safety snapshots (digests only: never returned or logged)
// ---------------------------------------------------------------------------

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export type OtherRow = { id: string; updatedAt: number; digest: string };

/** Identity and hash of every certificate outside the allowlist. */
async function otherCertificates(): Promise<Map<string, OtherRow>> {
  const rows = await db.certificate.findMany({
    where: { certificateId: { notIn: [...LEGACY_CERTIFICATE_IDS] } },
    select: {
      id: true,
      certificateId: true,
      userId: true,
      issuedAt: true,
      verificationHash: true,
      updatedAt: true,
    },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        updatedAt: r.updatedAt.getTime(),
        digest: digest([r.certificateId, r.userId, r.issuedAt, r.verificationHash]),
      },
    ])
  );
}

/**
 * True unless a certificate outside the allowlist changed without its
 * updatedAt moving. This operation writes raw SQL that never touches
 * updatedAt, so that is exactly its signature; ordinary application writes
 * made meanwhile (Prisma bumps updatedAt) and new rows are not counted.
 */
export function othersUnchanged(
  before: Map<string, OtherRow>,
  after: Map<string, OtherRow>
): boolean {
  for (const [id, prev] of before) {
    const next = after.get(id);
    if (next && next.updatedAt === prev.updatedAt && next.digest !== prev.digest) {
      return false;
    }
  }
  return true;
}

/** Every field of the legacy certificates except verificationHash, and their payments. */
async function legacySnapshot() {
  const certificates = await db.certificate.findMany({
    where: { certificateId: { in: [...LEGACY_CERTIFICATE_IDS] } },
    orderBy: { certificateId: "asc" },
    omit: { verificationHash: true },
    include: { payment: true },
  });
  return {
    fields: digest(certificates.map(({ payment: _payment, ...rest }) => rest)),
    payments: digest(certificates.map((c) => c.payment)),
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export async function resignLegacyCertificates(mode: ResignMode): Promise<ResignSummary> {
  const runId = randomUUID();
  const [othersBefore, legacyBefore] = await Promise.all([
    otherCertificates(),
    legacySnapshot(),
  ]);

  const certificates: Result[] = [];
  for (const certificateId of LEGACY_CERTIFICATE_IDS) {
    certificates.push(
      mode === "apply"
        ? await resign(certificateId, runId)
        : mode === "rollback"
          ? await rollback(certificateId, runId)
          : await evaluate(certificateId)
    );
  }

  const [othersAfter, legacyAfter] = await Promise.all([
    otherCertificates(),
    legacySnapshot(),
  ]);

  const counts: ResignSummary["counts"] = {};
  for (const { outcome } of certificates) counts[outcome] = (counts[outcome] ?? 0) + 1;
  const summary: ResignSummary = {
    mode,
    runId,
    counts,
    certificates,
    safety: {
      otherCertificatesUnchanged: othersUnchanged(othersBefore, othersAfter),
      legacyCertificateFieldsUnchanged: legacyBefore.fields === legacyAfter.fields,
      legacyPaymentsUnchanged: legacyBefore.payments === legacyAfter.payments,
    },
  };

  const safe = Object.values(summary.safety).every(Boolean);
  const log = { mode, runId, counts, safety: summary.safety };
  if (safe) logger.info("Legacy certificate re-sign run", log);
  else
    logger.error("Legacy certificate re-sign run: safety check failed", undefined, log);
  return summary;
}
