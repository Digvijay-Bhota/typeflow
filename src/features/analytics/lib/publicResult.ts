import { evaluateCertificateEligibility } from "@/lib/certificateEligibility";
import { deriveTraceDiagnostics } from "@/features/typing/lib/traceAnalysis";

/** Interval WPM from the stored trace, when the result was reconstructed from it. */
function traceIntervalWpms(result: any): number[] | null {
  const passage = result.session?.passage?.content;
  const events = result.eventTrace?.events;
  if (
    result.scoringSource !== "SERVER_RECONSTRUCTED" ||
    typeof passage !== "string" ||
    !Array.isArray(events)
  ) {
    return null;
  }
  return deriveTraceDiagnostics(passage, result.eventTrace).intervalWpms;
}

/**
 * Public view of a result for the share page.
 *
 * `includeId` exposes the internal result id; pass it only when the viewer
 * owns the result (it backs the owner-only "practice these keys" link).
 */
export function getPublicResult(result: any, options: { includeId?: boolean } = {}) {
  // Derive intervalWpms: server-derived from the trace for reconstructed
  // results, otherwise the client-reported samples.
  let intervalWpms: number[] = traceIntervalWpms(result) ?? [];
  if (
    intervalWpms.length === 0 &&
    result.scoringSource !== "SERVER_RECONSTRUCTED" &&
    result.integritySignals &&
    typeof result.integritySignals === "object"
  ) {
    const rawIntervals = (result.integritySignals as any).intervalWpms;
    if (Array.isArray(rawIntervals)) {
      intervalWpms = rawIntervals.filter(
        (val) => typeof val === "number" && Number.isFinite(val) && val >= 0
      );
    }
  }

  // Derive weakKeys
  let weakKeys: { key: string; count: number }[] = [];
  if (result.errorMap && typeof result.errorMap === "object") {
    const entries = Object.entries(result.errorMap as Record<string, any>);
    for (const [key, val] of entries) {
      if (
        val &&
        typeof val === "object" &&
        typeof val.count === "number" &&
        Number.isFinite(val.count) &&
        val.count >= 0
      ) {
        weakKeys.push({ key, count: val.count });
      }
    }
    weakKeys.sort((a, b) => b.count - a.count);
    weakKeys = weakKeys.slice(0, 8);
  }

  const publicSession = result.session
    ? {
        mode: result.session.mode,
        language: result.session.language,
        codeLanguage: result.session.codeLanguage,
        trustTier: result.session.trustTier,
        duration: result.session.duration,
        passage: result.session.passage
          ? {
              sourceAttribution: result.session.passage.sourceAttribution,
            }
          : null,
      }
    : null;

  const certificate = evaluateCertificateEligibility({
    netWpm: result.netWpm,
    accuracy: result.accuracy,
    duration: result.session?.duration ?? null,
    integrityStatus: result.integrityStatus,
    scoringSource: result.scoringSource,
    trustTier: result.session?.trustTier ?? "",
    userId: result.userId ?? null,
  });

  return {
    ...(options.includeId ? { id: result.id } : {}),
    shareId: result.shareId,
    wpm: result.wpm,
    rawWpm: result.rawWpm,
    netWpm: result.netWpm,
    accuracy: result.accuracy,
    consistency: result.consistency,
    correctChars: result.correctChars,
    incorrectChars: result.incorrectChars,
    totalChars: result.totalChars,
    totalKeystrokes: result.totalKeystrokes,
    correctedErrors: result.correctedErrors,
    uncorrectedErrors: result.uncorrectedErrors,
    integrityStatus: result.integrityStatus,
    scoringSource: result.scoringSource,
    isCertificateEligible: certificate.eligible,
    // An unclaimed guest result that qualifies once claimed into an account.
    certificateEligibleAfterClaim: !result.userId && certificate.eligibleOnceSignedIn,
    createdAt: result.createdAt,
    session: publicSession,
    intervalWpms,
    weakKeys,
  };
}
