import { db } from "@/server/db";
import { getServerEnv } from "@/lib/env";
import { CERTIFICATE_ID_PREFIX } from "@/lib/constants";
import {
  evaluateCertificateEligibility,
  type CertificateEligibility,
} from "@/lib/certificateEligibility";
import {
  certificateOwnerState,
  certificateVerifyPath,
  CERTIFICATE_ID_PATTERN,
  verificationState,
  VERIFICATION_MESSAGES,
  type OwnerCertificate,
  type VerificationState,
} from "@/lib/certificateStatus";
import { logger } from "@/lib/logger";
import { createHmac, timingSafeEqual } from "crypto";
import type { Certificate, Prisma } from "@prisma/client";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";
import { ServiceError, isUniqueViolation } from "@/server/errors";

export type EligibilityResult = CertificateEligibility;

export async function checkCertificateEligibility(
  resultId: string
): Promise<EligibilityResult> {
  const result = await db.testResult.findUnique({
    where: { id: resultId },
    include: { session: true },
  });

  if (!result) throw new Error("Result not found");

  return evaluateCertificateEligibility({
    netWpm: result.netWpm,
    accuracy: result.accuracy,
    duration: result.session.duration,
    integrityStatus: result.integrityStatus,
    scoringSource: result.scoringSource,
    trustTier: result.session.trustTier,
    userId: result.userId,
  });
}

export function generateVerificationHash(
  certificateId: string,
  userId: string,
  issuedAt: Date
): string {
  const { CERTIFICATE_SIGNING_SECRET } = getServerEnv();
  const payload = `${certificateId}:${userId}:${issuedAt.toISOString()}`;
  return createHmac("sha256", CERTIFICATE_SIGNING_SECRET).update(payload).digest("hex");
}

function generateCertificateId(): string {
  const year = new Date().getFullYear();
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${CERTIFICATE_ID_PREFIX}-${year}-${random}`;
}

/**
 * Issues (or returns the existing) PENDING_PAYMENT certificate for a result.
 * Ownership is checked before eligibility so another user's result never
 * reveals its eligibility details. Idempotent per result, including under
 * concurrent requests (unique resultId).
 */
export async function createCertificate(userId: string, resultId: string) {
  const result = await db.testResult.findUnique({
    where: { id: resultId },
    include: { session: true },
  });
  if (!result) throw new ServiceError("Result not found", "NOT_FOUND", 404);
  if (result.userId !== userId) {
    throw new ServiceError("Result belongs to another user", "FORBIDDEN", 403);
  }

  const existing = await db.certificate.findUnique({ where: { resultId } });
  if (existing) {
    if (existing.userId !== userId) {
      throw new ServiceError("Result belongs to another user", "FORBIDDEN", 403);
    }
    return existing;
  }

  const eligibility = evaluateCertificateEligibility({
    netWpm: result.netWpm,
    accuracy: result.accuracy,
    duration: result.session.duration,
    integrityStatus: result.integrityStatus,
    scoringSource: result.scoringSource,
    trustTier: result.session.trustTier,
    userId: result.userId,
  });
  if (!eligibility.eligible) {
    throw new ServiceError(
      `Not eligible for certificate: ${eligibility.reasons.join(", ")}`,
      "NOT_ELIGIBLE",
      422
    );
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const certId = generateCertificateId();
    const issuedAt = new Date();
    try {
      return await db.certificate.create({
        data: {
          certificateId: certId,
          verificationHash: generateVerificationHash(certId, userId, issuedAt),
          userId,
          resultId,
          status: "PENDING_PAYMENT",
          testType: `${result.session.mode} Typing Assessment`,
          language: result.session.language,
          duration: result.session.duration || 0,
          wpm: result.netWpm,
          rawWpm: result.rawWpm,
          accuracy: result.accuracy,
          issuedAt,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error, "resultId")) {
        // A concurrent request issued it first.
        const winner = await db.certificate.findUnique({ where: { resultId } });
        if (winner?.userId === userId) return winner;
        throw new ServiceError("Result belongs to another user", "FORBIDDEN", 403);
      }
      // Random certificateId collision: retry with a new one.
      if (isUniqueViolation(error, "certificateId")) continue;
      throw error;
    }
  }
  throw new Error("Could not allocate a unique certificate id");
}

// ---------------------------------------------------------------------------
// Fulfillment: PENDING_FULFILLMENT ──(PDF + QR generated and stored)──▶ ACTIVE
// ---------------------------------------------------------------------------

const CERTIFICATE_BUCKET = "certificates";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Absolute URL of the public verification page; the QR code encodes exactly this. */
export function certificateVerifyUrl(certificateId: string): string {
  return new URL(certificateVerifyPath(certificateId), getServerEnv().APP_URL).toString();
}

/** Recipient shown on the PDF and the verification page. */
export function certificateRecipientName(displayName: string | null | undefined): string {
  return displayName?.trim() || "Anonymous Typist";
}

type CertificateForPdf = Pick<
  Certificate,
  "certificateId" | "testType" | "language" | "duration" | "wpm" | "accuracy" | "issuedAt"
> & { recipientName: string };

/**
 * Renders the certificate PDF. Only the public snapshot is used: no trace,
 * hashes, session, payment or internal IDs. Deterministic for a given
 * certificate (the PDF dates are pinned to issuedAt), so a retried upload
 * writes identical bytes.
 */
export async function renderCertificatePdf(
  cert: CertificateForPdf,
  verifyUrl: string
): Promise<Uint8Array> {
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 150 });

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setCreationDate(cert.issuedAt);
  pdfDoc.setModificationDate(cert.issuedAt);
  const page = pdfDoc.addPage([842, 595]);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  page.drawText("TypeFlow", {
    x: 50,
    y: 500,
    size: 40,
    font: fontBold,
    color: rgb(0.2, 0.4, 0.8),
  });
  page.drawText("Verified Typing Performance Certificate", {
    x: 50,
    y: 460,
    size: 24,
    font,
  });

  page.drawText(`Recipient: ${cert.recipientName}`, { x: 50, y: 380, size: 18, font });
  page.drawText(`Assessment: ${cert.testType}`, { x: 50, y: 340, size: 16, font });
  page.drawText(`Language: ${cert.language}`, { x: 50, y: 310, size: 16, font });
  page.drawText(`Duration: ${cert.duration} seconds`, { x: 50, y: 280, size: 16, font });

  page.drawText(`WPM: ${Math.round(cert.wpm)}`, {
    x: 400,
    y: 380,
    size: 30,
    font: fontBold,
  });
  page.drawText(`Accuracy: ${(cert.accuracy * 100).toFixed(1)}%`, {
    x: 400,
    y: 340,
    size: 24,
    font,
  });

  page.drawText(`Certificate ID: ${cert.certificateId}`, {
    x: 50,
    y: 100,
    size: 12,
    font,
  });
  page.drawText(`Issued: ${cert.issuedAt.toISOString().split("T")[0]}`, {
    x: 50,
    y: 80,
    size: 12,
    font,
  });
  page.drawText(`Verify: ${verifyUrl}`, { x: 50, y: 60, size: 10, font });
  page.drawText("Verified by TypeFlow's server-side typing assessment system.", {
    x: 50,
    y: 40,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  const qrImageBytes = Buffer.from(qrDataUrl.split(",")[1] || "", "base64");
  const qrImage = await pdfDoc.embedPng(qrImageBytes);
  page.drawImage(qrImage, { x: 650, y: 50, width: 120, height: 120 });

  return pdfDoc.save();
}

/**
 * Stores the PDF at its fixed per-certificate path (upsert, so a retry after a
 * partial failure overwrites the same object) and returns its public URL.
 * Throws on any storage failure: there is no fallback URL.
 */
async function uploadCertificatePdf(
  certificateId: string,
  pdfBytes: Uint8Array
): Promise<string> {
  const { createAdminClient } = await import("@/lib/supabase/server");
  const storage = createAdminClient().storage.from(CERTIFICATE_BUCKET);
  const storagePath = `certificates/${certificateId}.pdf`;

  const { error } = await storage.upload(storagePath, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw error;

  const { data } = storage.getPublicUrl(storagePath);
  if (!data?.publicUrl) throw new Error("Storage returned no public URL");
  return data.publicUrl;
}

export type FulfillmentResult = {
  /** Status after this call. */
  status: Certificate["status"];
  /** True only for the call that moved the certificate to ACTIVE. */
  activated: boolean;
};

/**
 * Generates and stores the PDF + QR for a paid certificate, then activates it.
 *
 * Runs outside any transaction, after the payment capture has committed.
 * Idempotent and safe to retry or run concurrently:
 *  - ACTIVE → returns without regenerating anything;
 *  - anything but PENDING_FULFILLMENT (unpaid, revoked) → no-op;
 *  - the final step is a compare-and-set PENDING_FULFILLMENT → ACTIVE that also
 *    persists pdfUrl/qrData, so ACTIVE is only ever set together with them, a
 *    concurrent fulfiller cannot activate twice, and a certificate revoked
 *    meanwhile is never reactivated.
 * On failure the certificate stays PENDING_FULFILLMENT with its identity and
 * verificationHash unchanged; nothing is charged or created again.
 */
export async function fulfillCertificate(
  certificateId: string
): Promise<FulfillmentResult> {
  const cert = await db.certificate.findUnique({
    where: { certificateId },
    include: { user: { select: { displayName: true } } },
  });
  if (!cert) throw new ServiceError("Certificate not found", "NOT_FOUND", 404);
  if (cert.status !== "PENDING_FULFILLMENT") {
    return { status: cert.status, activated: false };
  }

  const verifyUrl = certificateVerifyUrl(cert.certificateId);
  let pdfUrl: string;
  try {
    const pdfBytes = await renderCertificatePdf(
      { ...cert, recipientName: certificateRecipientName(cert.user.displayName) },
      verifyUrl
    );
    pdfUrl = await uploadCertificatePdf(cert.certificateId, pdfBytes);
  } catch (error) {
    logger.error("Certificate fulfillment failed; will stay PENDING_FULFILLMENT", error, {
      certificateId: cert.certificateId,
    });
    throw new ServiceError(
      "Your certificate could not be prepared yet. Please try again shortly.",
      "FULFILLMENT_FAILED",
      503
    );
  }

  const { count } = await db.certificate.updateMany({
    where: { id: cert.id, status: "PENDING_FULFILLMENT" },
    data: { status: "ACTIVE", pdfUrl, qrData: verifyUrl },
  });
  if (count === 1) {
    logger.info("Certificate activated", { certificateId: cert.certificateId });
    return { status: "ACTIVE", activated: true };
  }

  // A concurrent fulfiller activated it, or it was revoked meanwhile.
  const current = await db.certificate.findUniqueOrThrow({
    where: { id: cert.id },
    select: { status: true },
  });
  return { status: current.status, activated: false };
}

/**
 * Owner-triggered fulfillment retry (e.g. after a storage outage during the
 * webhook). Only completes an already-paid certificate; never charges or
 * creates anything.
 */
export async function retryCertificateFulfillment(
  userId: string,
  certificateId: string
): Promise<FulfillmentResult> {
  const cert = await db.certificate.findUnique({
    where: { certificateId },
    select: { userId: true, status: true },
  });
  // Another user's certificate is indistinguishable from a missing one.
  if (!cert || cert.userId !== userId) {
    throw new ServiceError("Certificate not found", "NOT_FOUND", 404);
  }
  if (cert.status === "ACTIVE") return { status: "ACTIVE", activated: false };
  if (cert.status !== "PENDING_FULFILLMENT") {
    throw new ServiceError(
      "This certificate is not awaiting preparation",
      "NOT_FULFILLABLE",
      409
    );
  }
  return fulfillCertificate(certificateId);
}

// ---------------------------------------------------------------------------
// Public verification
// ---------------------------------------------------------------------------

/** Constant-time check that the stored verificationHash matches its source data. */
export function hasValidVerificationHash(
  cert: Pick<Certificate, "certificateId" | "userId" | "issuedAt" | "verificationHash">
): boolean {
  const expected = Buffer.from(
    generateVerificationHash(cert.certificateId, cert.userId, cert.issuedAt),
    "utf8"
  );
  const stored = Buffer.from(cert.verificationHash, "utf8");
  return stored.length === expected.length && timingSafeEqual(stored, expected);
}

export type CertificateVerification =
  | {
      certificateId: string;
      state: "VERIFIED";
      message: string;
      recipientName: string;
      testType: string;
      language: Certificate["language"];
      duration: number;
      wpm: number;
      accuracy: number;
      issuedAt: Date;
      pdfUrl: string | null;
    }
  | {
      certificateId: string;
      state: Exclude<VerificationState, "VERIFIED">;
      message: string;
    };

/**
 * Public, status-aware verification by certificate ID. Returns null for an
 * unknown ID. Details are included only for a verified certificate, and never
 * the hash, owner/result/payment IDs or anything from the session.
 */
export async function getCertificateVerification(
  certificateId: string
): Promise<CertificateVerification | null> {
  if (!CERTIFICATE_ID_PATTERN.test(certificateId)) return null;

  const cert = await db.certificate.findUnique({
    where: { certificateId },
    include: { user: { select: { displayName: true } } },
  });
  if (!cert) return null;

  const state = verificationState(cert, hasValidVerificationHash(cert));
  const message = VERIFICATION_MESSAGES[state];
  if (state !== "VERIFIED") {
    return { certificateId: cert.certificateId, state, message };
  }

  return {
    certificateId: cert.certificateId,
    state,
    message,
    recipientName: certificateRecipientName(cert.user.displayName),
    testType: cert.testType,
    language: cert.language,
    duration: cert.duration,
    wpm: cert.wpm,
    accuracy: cert.accuracy,
    issuedAt: cert.issuedAt,
    pdfUrl: cert.pdfUrl,
  };
}

/** Maps a legacy internal-ID certificate link to its public certificate ID. */
export async function findPublicCertificateId(
  internalId: string
): Promise<string | null> {
  // A malformed UUID is just an unknown certificate.
  if (!UUID_PATTERN.test(internalId)) return null;
  const cert = await db.certificate.findUnique({
    where: { id: internalId },
    select: { certificateId: true },
  });
  return cert?.certificateId ?? null;
}

// ---------------------------------------------------------------------------
// Owner view
// ---------------------------------------------------------------------------

/** Authoritative certificate/purchase state of a result, for its owner only. */
export async function getOwnerCertificate(
  userId: string,
  resultId: string
): Promise<OwnerCertificate> {
  const cert = await db.certificate.findUnique({
    where: { resultId },
    select: {
      userId: true,
      certificateId: true,
      status: true,
      expiresAt: true,
      payment: { select: { status: true } },
    },
  });
  if (!cert || cert.userId !== userId) return { state: "NONE", certificateId: null };
  return {
    state: certificateOwnerState(cert, cert.payment?.status ?? null),
    certificateId: cert.certificateId,
  };
}

// ---------------------------------------------------------------------------
// Revocation (REVOKED is terminal)
// ---------------------------------------------------------------------------

/**
 * Revokes a certificate inside the caller's transaction. Idempotent: an
 * already-revoked certificate keeps its original revokedAt/revokedReason.
 * Returns true if this call revoked it.
 */
export async function revokeCertificateTx(
  tx: Prisma.TransactionClient,
  where: { id: string } | { certificateId: string },
  reason: string
): Promise<boolean> {
  const { count } = await tx.certificate.updateMany({
    where: { ...where, status: { not: "REVOKED" } },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedReason: reason.slice(0, 500),
    },
  });
  return count === 1;
}

/**
 * Admin revocation primitive. There is deliberately no public or user-facing
 * endpoint: callers must pass an authenticated user ID, which is checked for
 * the ADMIN role here. Takes effect immediately on the verification page.
 */
export async function revokeCertificate(
  adminUserId: string,
  certificateId: string,
  reason: string
) {
  const admin = await db.user.findUnique({
    where: { id: adminUserId },
    select: { role: true },
  });
  if (admin?.role !== "ADMIN") {
    throw new ServiceError("Only admins can revoke certificates", "FORBIDDEN", 403);
  }

  const trimmed = reason.trim();
  if (!trimmed || trimmed.length > 480) {
    throw new ServiceError(
      "A revocation reason (1-480 characters) is required",
      "BAD_REQUEST",
      400
    );
  }

  const revoked = await revokeCertificateTx(db, { certificateId }, `ADMIN: ${trimmed}`);
  const cert = await db.certificate.findUnique({ where: { certificateId } });
  if (!cert) throw new ServiceError("Certificate not found", "NOT_FOUND", 404);

  if (revoked) {
    logger.warn("Certificate revoked by admin", {
      certificateId,
      adminUserId,
    });
  }
  return cert;
}
