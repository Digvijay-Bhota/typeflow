import { db } from "@/server/db";
import { TestResultPublic } from "@/types/typing";

export async function getResultByShareId(
  shareId: string
): Promise<TestResultPublic | null> {
  const result = await db.testResult.findUnique({
    where: { shareId },
    include: {
      session: {
        include: { passage: true },
      },
      user: {
        select: { displayName: true },
      },
      certificate: {
        select: { certificateId: true, status: true },
      },
    },
  });

  if (!result) return null;

  const publicResult: TestResultPublic = {
    resultId: result.id,
    shareId: result.shareId,
    shareUrl: `/result/${result.shareId}`,
    wpm: result.wpm,
    rawWpm: result.rawWpm,
    netWpm: result.netWpm,
    accuracy: result.accuracy,
    consistency: result.consistency,
    correctChars: result.correctChars,
    incorrectChars: result.incorrectChars,
    totalChars: result.totalChars,
    correctedErrors: result.correctedErrors,
    uncorrectedErrors: result.uncorrectedErrors,
    elapsedMs: result.elapsedMs,
    duration: result.duration,
    mode: result.session.mode,
    language: result.session.language,
    errorMap: result.errorMap
      ? (result.errorMap as Record<
          string,
          { expected: string; count: number; corrected: number; uncorrected: number }
        >)
      : null,
    integrityStatus: result.integrityStatus as "VERIFIED" | "REVIEW" | "INVALID",
    createdAt: result.createdAt.toISOString(),
    isCertificateEligible:
      result.session.trustTier === "CERTIFICATE" && result.integrityStatus === "VERIFIED",
    displayName: result.user?.displayName || null,
    certificateId:
      result.certificate?.status === "ACTIVE" ? result.certificate.certificateId : null,
  };

  if (result.session.codeLanguage) {
    publicResult.codeLanguage = result.session.codeLanguage;
  }
  if (result.codeMetrics) {
    publicResult.codeMetrics = result.codeMetrics;
  }

  return publicResult;
}
