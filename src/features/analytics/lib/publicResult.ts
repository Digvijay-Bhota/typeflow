
export function getPublicResult(result: any) {
  // Derive intervalWpms
  let intervalWpms: number[] = [];
  if (result.integritySignals && typeof result.integritySignals === "object") {
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
      if (val && typeof val === "object" && typeof val.count === "number" && Number.isFinite(val.count) && val.count >= 0) {
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

  return {
    id: result.id,
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
    createdAt: result.createdAt,
    session: publicSession,
    intervalWpms,
    weakKeys,
  };
}
