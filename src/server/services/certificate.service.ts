import { db } from "@/server/db";
import {
  CERTIFICATE_MIN_WPM,
  CERTIFICATE_MIN_ACCURACY,
  CERTIFICATE_MIN_DURATION,
  CERTIFICATE_ID_PREFIX,
} from "@/lib/constants";
import { createHmac } from "crypto";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import QRCode from "qrcode";

const CERT_SECRET = process.env.SESSION_SECRET || "fallback-secret-minimum-32-chars-long";

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
  thresholdSummary: {
    wpm: { actual: number; required: number; passed: boolean };
    accuracy: { actual: number; required: number; passed: boolean };
    duration: { actual: number; required: number; passed: boolean };
  };
}

export async function checkCertificateEligibility(
  resultId: string
): Promise<EligibilityResult> {
  const result = await db.testResult.findUnique({
    where: { id: resultId },
    include: { session: true },
  });

  if (!result) throw new Error("Result not found");

  const wpmPassed = result.netWpm >= CERTIFICATE_MIN_WPM;
  const accPassed = result.accuracy * 100 >= CERTIFICATE_MIN_ACCURACY;
  const durationPassed = (result.session.duration || 0) >= CERTIFICATE_MIN_DURATION;
  const isVerified = result.integrityStatus === "VERIFIED";
  const isCertMode = result.session.trustTier === "CERTIFICATE";

  const reasons: string[] = [];
  if (!wpmPassed)
    reasons.push(
      `Net WPM below minimum (${result.netWpm.toFixed(1)} < ${CERTIFICATE_MIN_WPM})`
    );
  if (!accPassed)
    reasons.push(
      `Accuracy below minimum (${(result.accuracy * 100).toFixed(1)}% < ${CERTIFICATE_MIN_ACCURACY}%)`
    );
  if (!durationPassed)
    reasons.push(
      `Test duration below minimum (${result.session.duration || 0}s < ${CERTIFICATE_MIN_DURATION}s)`
    );
  if (!isVerified)
    reasons.push(`Result integrity is ${result.integrityStatus}, must be VERIFIED`);
  if (!isCertMode) reasons.push(`Test was not taken in CERTIFICATE trust tier`);
  if (!result.userId) reasons.push(`User must be authenticated`);

  const eligible =
    wpmPassed &&
    accPassed &&
    durationPassed &&
    isVerified &&
    isCertMode &&
    !!result.userId;

  return {
    eligible,
    reasons,
    thresholdSummary: {
      wpm: { actual: result.netWpm, required: CERTIFICATE_MIN_WPM, passed: wpmPassed },
      accuracy: {
        actual: result.accuracy * 100,
        required: CERTIFICATE_MIN_ACCURACY,
        passed: accPassed,
      },
      duration: {
        actual: result.session.duration || 0,
        required: CERTIFICATE_MIN_DURATION,
        passed: durationPassed,
      },
    },
  };
}

export function generateVerificationHash(
  certificateId: string,
  userId: string,
  issuedAt: Date
): string {
  const payload = `${certificateId}:${userId}:${issuedAt.toISOString()}`;
  return createHmac("sha256", CERT_SECRET).update(payload).digest("hex");
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

export async function createCertificate(userId: string, resultId: string) {
  const existing = await db.certificate.findUnique({
    where: { resultId },
  });
  if (existing) {
    if (existing.userId !== userId) {
      throw new Error("Result belongs to another user");
    }
    return existing;
  }

  const eligibility = await checkCertificateEligibility(resultId);
  if (!eligibility.eligible) {
    throw new Error(`Not eligible for certificate: ${eligibility.reasons.join(", ")}`);
  }

  const result = await db.testResult.findUniqueOrThrow({
    where: { id: resultId },
    include: { session: true, user: true },
  });

  // Strict check on userId
  if (result.userId !== userId) {
    throw new Error("Result belongs to another user");
  }

  let certId = generateCertificateId();
  // Handle collision
  while (await db.certificate.findUnique({ where: { certificateId: certId } })) {
    certId = generateCertificateId();
  }

  const issuedAt = new Date();
  const verificationHash = generateVerificationHash(certId, userId, issuedAt);

  const cert = await db.certificate.create({
    data: {
      certificateId: certId,
      verificationHash,
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

  return cert;
}

export async function generateCertificatePdfAndQr(certificateId: string) {
  const cert = await db.certificate.findUniqueOrThrow({
    where: { certificateId },
    include: { user: true },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const verifyUrl = `${baseUrl}/verify/${certificateId}`;

  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 150 });

  const pdfDoc = await PDFDocument.create();
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

  const recipientName = cert.user?.displayName || "Anonymous Typist";
  page.drawText(`Recipient: ${recipientName}`, { x: 50, y: 380, size: 18, font });
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
  page.drawText("Verified by TypeFlow's server-side typing assessment system.", {
    x: 50,
    y: 60,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });

  const qrImageBytes = Buffer.from(qrDataUrl?.split(",")[1] || "", "base64");
  const qrImage = await pdfDoc.embedPng(qrImageBytes);
  page.drawImage(qrImage, { x: 650, y: 50, width: 120, height: 120 });

  const pdfBytes = await pdfDoc.save();

  let pdfUrl = "";
  try {
    const { createAdminClient } = await import("@/lib/supabase/server");
    const supabase = createAdminClient();

    // Upload to Supabase Storage
    // Dedicated path using certificateId to prevent collisions
    const storagePath = `certificates/${certificateId}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("certificates")
      .upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("Failed to upload PDF to Supabase:", uploadError);
      throw uploadError;
    }

    const { data } = supabase.storage.from("certificates").getPublicUrl(storagePath);

    pdfUrl = data.publicUrl;
  } catch (error) {
    console.error(
      "Storage credentials unavailable or upload failed. Using fallback URL.",
      error
    );
    pdfUrl = `https://storage.typeflow.app/certificates/${certificateId}.pdf`;
  }

  const updatedCert = await db.certificate.update({
    where: { id: cert.id },
    data: {
      qrData: qrDataUrl,
      pdfUrl,
    },
  });

  return { pdfBytes, pdfUrl, qrDataUrl, certificate: updatedCert };
}

export async function getCertificateVerification(certificateId: string) {
  const cert = await db.certificate.findUnique({
    where: { certificateId },
    include: {
      user: {
        select: {
          displayName: true,
          email: true,
        },
      },
    },
  });

  if (!cert) return null;

  return {
    certificateId: cert.certificateId,
    status: cert.status,
    testType: cert.testType,
    language: cert.language,
    duration: cert.duration,
    wpm: cert.wpm,
    accuracy: cert.accuracy,
    issuedAt: cert.issuedAt,
    recipientName: cert.user?.displayName || "Anonymous Typist",
    qrData: cert.qrData,
    pdfUrl: cert.pdfUrl,
  };
}

export async function revokeCertificate(
  adminUserId: string,
  certificateId: string,
  reason: string
) {
  const admin = await db.user.findUnique({ where: { id: adminUserId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Unauthorized: Only admins can revoke certificates.");
  }

  const cert = await db.certificate.update({
    where: { certificateId },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });

  return cert;
}
