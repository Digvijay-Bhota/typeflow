/**
 * One-off repair of TF-2026-C9XGPR's QR code (Phase 6, F1). Temporary: removed
 * after the Production run, like the 5C-9 re-sign.
 *
 * TF-2026-C9XGPR was fulfilled on 2026-09-25 while Production's APP_URL was a
 * Preview branch URL, so its PDF (QR code and "Verify:" line) and `qrData`
 * point at a Vercel login wall instead of the verification page. This
 * re-renders that one PDF with the production verification URL, at the same
 * storage path, and updates `qrData`. Nothing else about the certificate, its
 * payment or any other certificate changes.
 *
 * Consistency: the PDF and `qrData` must never disagree. The apply runs in
 * one transaction that first locks the certificate row (SELECT … FOR UPDATE),
 * checks every precondition under the lock, reads the current PDF into
 * memory, uploads the replacement, then compare-and-sets `qrData` (old → new)
 * and writes the audit row. A concurrent run or writer waits for the lock. If
 * the upload or the transaction fails, the old PDF bytes are put back, but
 * only after re-reading `qrData` shows the transaction did not commit.
 *
 * No backup file is written to the (public) bucket: the original PDF is kept
 * in the audit row's metadata (audit_logs is server-only), which makes a
 * later rollback deterministic.
 */
import { createHash, randomUUID } from "crypto";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  decodePDFRawStream,
  type PDFObject,
} from "pdf-lib";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { logger } from "@/lib/logger";
import { deploymentEnvironment, productionAppUrlMismatch } from "@/lib/environmentGuard";
import {
  certificateRecipientName,
  certificateVerifyUrl,
  hasValidVerificationHash,
  renderCertificatePdf,
} from "./certificate.service";

export const QR_REPAIR = {
  certificateId: "TF-2026-C9XGPR",
  oldQrData:
    "https://typeflow-git-phase-5b-razorpay-validation-digvijaybhota.vercel.app/verify/TF-2026-C9XGPR",
  newQrData: "https://typeflow-dusky.vercel.app/verify/TF-2026-C9XGPR",
  oldHost: "typeflow-git-phase-5b-razorpay-validation-digvijaybhota.vercel.app",
  bucket: "certificates",
  storagePath: "certificates/TF-2026-C9XGPR.pdf",
  auditAction: "CERTIFICATE_QR_REPAIRED",
} as const;

export type QrRepairPrecondition =
  | "not_production"
  | "not_found"
  | "status_not_active"
  | "payment_not_completed"
  | "verification_hash_invalid"
  | "qr_data_unexpected"
  | "pdf_url_unexpected"
  | "app_url_not_production"
  | "replacement_url_unexpected";

type PdfFacts = { size: number; sha256: string };

export type QrRepairResult =
  | { outcome: "precondition_failed"; failed: QrRepairPrecondition[] }
  | { outcome: "already_repaired" }
  | {
      outcome: "dry_run";
      newQrData: string;
      currentPdf: PdfFacts & { reproducibleFromOldUrl: boolean };
      replacementPdf: PdfFacts;
    }
  | {
      outcome: "repaired";
      runId: string;
      newQrData: string;
      oldPdf: PdfFacts;
      newPdf: PdfFacts;
    };

/** A failure after the checks; `pdfRestored` says what happened to the PDF. */
export class QrRepairError extends Error {
  constructor(
    message: string,
    /** true: old PDF put back; false: putting it back failed; null: nothing to put back. */
    readonly pdfRestored: boolean | null
  ) {
    super(message);
    this.name = "QrRepairError";
  }
}

const certificateSelect = {
  id: true,
  certificateId: true,
  userId: true,
  status: true,
  verificationHash: true,
  issuedAt: true,
  qrData: true,
  pdfUrl: true,
  testType: true,
  language: true,
  duration: true,
  wpm: true,
  accuracy: true,
  user: { select: { displayName: true } },
  payment: { select: { status: true } },
} satisfies Prisma.CertificateSelect;

type RepairCertificate = Prisma.CertificateGetPayload<{
  select: typeof certificateSelect;
}>;

const facts = (bytes: Uint8Array): PdfFacts => ({
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});

/** Every failed precondition (empty when the repair may run). */
function preconditions(cert: RepairCertificate | null): QrRepairPrecondition[] {
  const failed: QrRepairPrecondition[] = [];
  if (deploymentEnvironment(process.env) !== "production") failed.push("not_production");
  if (!cert) return [...failed, "not_found"];
  if (cert.status !== "ACTIVE") failed.push("status_not_active");
  if (cert.payment?.status !== "COMPLETED") failed.push("payment_not_completed");
  if (!hasValidVerificationHash(cert)) failed.push("verification_hash_invalid");
  if (cert.qrData !== QR_REPAIR.oldQrData) failed.push("qr_data_unexpected");
  // The canonical path overwritten below must be the one pdfUrl serves.
  if (!cert.pdfUrl?.endsWith(`/${QR_REPAIR.bucket}/${QR_REPAIR.storagePath}`)) {
    failed.push("pdf_url_unexpected");
  }
  if (productionAppUrlMismatch(process.env)) failed.push("app_url_not_production");
  if (certificateVerifyUrl(QR_REPAIR.certificateId) !== QR_REPAIR.newQrData) {
    failed.push("replacement_url_unexpected");
  }
  return failed;
}

/** The decoded content of a PDF's first page (where every line is drawn). */
async function pageContent(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  if (doc.getPageCount() !== 1) throw new Error("Unexpected page count");
  const contents = doc.getPage(0).node.Contents();
  const streams: (PDFObject | undefined)[] =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
  let text = "";
  for (const stream of streams) {
    if (stream instanceof PDFRawStream) {
      text += Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    }
  }
  return text.toLowerCase();
}

/** Standard-font text is drawn as hex strings in the content stream. */
const drawn = (content: string, text: string) =>
  content.includes(Buffer.from(text, "latin1").toString("hex").toLowerCase());

/**
 * Renders the replacement PDF and proves its drawn "Verify:" line names the
 * new URL and nothing names the old host. The QR code is rendered by the same
 * deterministic renderer from the same, already-checked URL.
 */
async function renderReplacement(cert: RepairCertificate): Promise<Uint8Array> {
  const bytes = await renderCertificatePdf(
    { ...cert, recipientName: certificateRecipientName(cert.user.displayName) },
    QR_REPAIR.newQrData
  );
  const content = await pageContent(bytes);
  if (!drawn(content, `Verify: ${QR_REPAIR.newQrData}`)) {
    throw new QrRepairError("Replacement PDF does not show the new URL", null);
  }
  if (drawn(content, QR_REPAIR.oldHost)) {
    throw new QrRepairError("Replacement PDF still shows the old host", null);
  }
  return bytes;
}

async function bucket() {
  const { createAdminClient } = await import("@/lib/supabase/server");
  return createAdminClient().storage.from(QR_REPAIR.bucket);
}

async function downloadCurrentPdf(): Promise<Uint8Array> {
  const { data, error } = await (await bucket()).download(QR_REPAIR.storagePath);
  if (error || !data) throw new QrRepairError("Could not read the current PDF", null);
  return new Uint8Array(await data.arrayBuffer());
}

async function uploadPdf(bytes: Uint8Array): Promise<void> {
  const { error } = await (
    await bucket()
  ).upload(QR_REPAIR.storagePath, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw error;
}

const readCertificate = (client: Prisma.TransactionClient | typeof db) =>
  client.certificate.findUnique({
    where: { certificateId: QR_REPAIR.certificateId },
    select: certificateSelect,
  });

/** Checks, renders and compares; writes nothing. */
async function dryRun(): Promise<QrRepairResult> {
  const cert = await readCertificate(db);
  if (cert?.qrData === QR_REPAIR.newQrData) return { outcome: "already_repaired" };
  const failed = preconditions(cert);
  if (failed.length > 0 || !cert) return { outcome: "precondition_failed", failed };

  const replacement = await renderReplacement(cert);
  const current = await downloadCurrentPdf();
  const fromOldUrl = await renderCertificatePdf(
    { ...cert, recipientName: certificateRecipientName(cert.user.displayName) },
    QR_REPAIR.oldQrData
  );
  return {
    outcome: "dry_run",
    newQrData: QR_REPAIR.newQrData,
    currentPdf: {
      ...facts(current),
      reproducibleFromOldUrl: facts(fromOldUrl).sha256 === facts(current).sha256,
    },
    replacementPdf: facts(replacement),
  };
}

/** Transaction limits: the storage round trips happen while the row is locked. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

async function apply(): Promise<QrRepairResult> {
  const runId = randomUUID();
  let oldBytes: Uint8Array | null = null;
  let uploadAttempted = false;

  try {
    return await db.$transaction(async (tx) => {
      // Serialises this run with any other run or writer of the row.
      await tx.$queryRaw`SELECT id FROM certificates WHERE "certificateId" = ${QR_REPAIR.certificateId} FOR UPDATE`;
      const cert = await readCertificate(tx);
      if (cert?.qrData === QR_REPAIR.newQrData) {
        return { outcome: "already_repaired" } as const;
      }
      const failed = preconditions(cert);
      if (failed.length > 0 || !cert) {
        return { outcome: "precondition_failed", failed } as const;
      }

      const replacement = await renderReplacement(cert);
      const current = await downloadCurrentPdf();
      oldBytes = current;

      uploadAttempted = true;
      await uploadPdf(replacement);

      // Compare-and-set as well as the lock: only the expected old value moves.
      const { count } = await tx.certificate.updateMany({
        where: { id: cert.id, status: "ACTIVE", qrData: QR_REPAIR.oldQrData },
        data: { qrData: QR_REPAIR.newQrData },
      });
      if (count !== 1) throw new Error("qrData compare-and-set did not match");

      const oldPdf = facts(current);
      const newPdf = facts(replacement);
      await tx.auditLog.create({
        data: {
          action: QR_REPAIR.auditAction,
          resource: "Certificate",
          resourceId: QR_REPAIR.certificateId,
          metadata: {
            runId,
            reason:
              "Fulfilled on 2026-09-25 with a Preview branch APP_URL; QR code and Verify line re-rendered with the production verification URL (Phase 6, F1)",
            oldQrData: QR_REPAIR.oldQrData,
            newQrData: QR_REPAIR.newQrData,
            storagePath: QR_REPAIR.storagePath,
            oldPdfSha256: oldPdf.sha256,
            oldPdfSize: oldPdf.size,
            newPdfSha256: newPdf.sha256,
            newPdfSize: newPdf.size,
            // For a deterministic rollback without a public backup file.
            oldPdfBase64: Buffer.from(current).toString("base64"),
          },
        },
      });

      logger.warn("Certificate QR repaired", {
        certificateId: QR_REPAIR.certificateId,
        runId,
      });
      return {
        outcome: "repaired",
        runId,
        newQrData: QR_REPAIR.newQrData,
        oldPdf,
        newPdf,
      } as const;
    }, TX_OPTIONS);
  } catch (error) {
    const pdfRestored = await restoreIfNotCommitted(uploadAttempted, oldBytes);
    if (pdfRestored === "committed") {
      // The transaction committed although the call reported an error.
      logger.warn("Certificate QR repair committed despite an error", { runId });
      return { outcome: "already_repaired" };
    }
    logger.error(
      "Certificate QR repair failed",
      error instanceof Error ? error : undefined,
      { certificateId: QR_REPAIR.certificateId, runId, pdfRestored }
    );
    throw new QrRepairError("Certificate QR repair failed", pdfRestored);
  }
}

/**
 * After a failure: put the old PDF back, but only when `qrData` still holds
 * the old URL (the transaction did not commit). "committed" when it holds the
 * new URL; null when no upload was attempted.
 */
async function restoreIfNotCommitted(
  uploadAttempted: boolean,
  oldBytes: Uint8Array | null
): Promise<boolean | null | "committed"> {
  if (!uploadAttempted || !oldBytes) return null;
  const now = await db.certificate.findUnique({
    where: { certificateId: QR_REPAIR.certificateId },
    select: { qrData: true },
  });
  if (now?.qrData === QR_REPAIR.newQrData) return "committed";
  try {
    await uploadPdf(oldBytes);
    return true;
  } catch {
    return false;
  }
}

export function repairCertificateQr(options: {
  dryRun: boolean;
}): Promise<QrRepairResult> {
  return options.dryRun ? dryRun() : apply();
}
