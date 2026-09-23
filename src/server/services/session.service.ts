import { randomBytes, createHash } from "crypto";
import { Language, TypingMode, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { CreateSessionRequest, StartSessionRequest } from "@/schemas/session.schema";
import { SubmitResultRequest } from "@/schemas/result.schema";
import {
  calculateWpm,
  calculateRawWpm,
  calculateNetWpm,
  calculateAccuracy,
} from "@/features/typing/lib/metrics";
import { calculateCodeMetrics } from "@/features/typing/lib/codeMetrics";

const GRACE_PERIOD_MS = 5000; // 5 seconds grace period for submission latency
const SESSION_VALIDITY_MS = 60 * 60 * 1000; // 1 hour overall expiry to start

export async function createSession(params: CreateSessionRequest) {
  let trustTier: "FREE" | "CERTIFICATE" | "B2B_ASSESSMENT" = "FREE";

  if (params.certificateMode) {
    trustTier = "CERTIFICATE";
  }

  // Handle B2B Attempt
  let b2bAttemptId: string | null = null;

  if (params.inviteToken && params.attemptId) {
    const candidate = await db.assessmentCandidate.findUnique({
      where: {
        inviteTokenHash: createHash("sha256").update(params.inviteToken).digest("hex"),
      },
      include: { assessment: true },
    });

    if (!candidate || candidate.assessment.status !== "PUBLISHED") {
      throw new Error("INVALID_OR_CLOSED_ASSESSMENT");
    }

    const attempt = await db.assessmentAttempt.findUnique({
      where: { id: params.attemptId },
    });

    if (
      !attempt ||
      attempt.candidateId !== candidate.id ||
      attempt.status !== "STARTED"
    ) {
      throw new Error("INVALID_ATTEMPT");
    }

    trustTier = "B2B_ASSESSMENT";
    b2bAttemptId = attempt.id;

    // Server overrides candidate settings
    params.mode = candidate.assessment.testMode === "CODE" ? "code" : "timed";
    params.language = candidate.assessment.language.toLowerCase() as any;
    if (params.language === "code") {
      params.codeLanguage = candidate.assessment.codeLanguage?.toLowerCase() as any;
    }
    params.duration = candidate.assessment.duration;
  }

  const { getAuthenticatedUser } = await import("./auth.service");
  const user = await getAuthenticatedUser();

  let passage: any;

  if (params.mode === "practice") {
    // Determine weak keys
    let weakKeys: string[] = [];

    if (params.sourceResultId) {
      if (!user) {
        throw new Error("UNAUTHORIZED_PRACTICE");
      }
      // Practice from a specific result (must be owned by the user)
      const sourceResult = await db.testResult.findUnique({
        where: { id: params.sourceResultId },
      });

      // IDOR protection: strictly verify ownership
      if (!sourceResult || sourceResult.userId !== user.id) {
        throw new Error("UNAUTHORIZED_PRACTICE");
      }

      if (sourceResult.errorMap && typeof sourceResult.errorMap === "object") {
        const map = sourceResult.errorMap as Record<string, any>;
        weakKeys = Object.entries(map)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 5)
          .map(([k]) => k);
      }
    } else if (user) {
      // Practice from dashboard (recent aggregate)
      const recentResults = await db.testResult.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      const mistakeCounts: Record<string, number> = {};
      recentResults.forEach((r) => {
        if (r.errorMap && typeof r.errorMap === "object") {
          Object.entries(r.errorMap as Record<string, any>).forEach(([k, v]) => {
            if (v && typeof v.count === "number") {
              mistakeCounts[k] = (mistakeCounts[k] || 0) + v.count;
            }
          });
        }
      });
      weakKeys = Object.entries(mistakeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k);
    }

    const { generateTargetedPassage } = await import("./practice.service");
    passage = await generateTargetedPassage(
      params.language.toUpperCase() as Language,
      weakKeys,
      params.wordCount || 30
    );
  } else {
    // Normal passage selection
    const passages = await db.passage.findMany({
      where: {
        language: params.language.toUpperCase() as Language,
        ...(params.language === "code" && params.codeLanguage
          ? { codeLanguage: params.codeLanguage.toUpperCase() as any }
          : {}),
        isActive: true,
        mode: params.certificateMode ? "CERTIFICATE" : "NORMAL",
      },
    });

    if (passages.length === 0) {
      throw new Error("No passages found for the requested criteria");
    }

    passage = passages[Math.floor(Math.random() * passages.length)];
  }

  const integrityToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_VALIDITY_MS);

  let session;
  if (b2bAttemptId) {
    session = await db.$transaction(async (tx) => {
      const newSession = await tx.testSession.create({
        data: {
          userId: user?.id ?? null,
          mode: params.mode.toUpperCase() as TypingMode,
          language: params.language.toUpperCase() as Language,
          duration: params.duration ?? null,
          wordCount: params.wordCount ?? null,
          trustTier: trustTier,
          status: "PENDING",
          passageId: passage.id,
          integrityToken,
          expiresAt,
        },
      });

      const attached = await tx.assessmentAttempt.updateMany({
        where: {
          id: b2bAttemptId,
          status: "STARTED",
          sessionId: null, // Strictly prevent overwriting an existing sessionId
        },
        data: {
          sessionId: newSession.id,
        },
      });

      if (attached.count === 0) {
        throw new Error("DUPLICATE_SESSION");
      }

      return newSession;
    });
  } else {
    // Non-B2B flow (unchanged)
    session = await db.testSession.create({
      data: {
        userId: user?.id ?? null,
        mode: params.mode.toUpperCase() as TypingMode,
        language: params.language.toUpperCase() as Language,
        duration: params.duration ?? null,
        wordCount: params.wordCount ?? null,
        trustTier: trustTier,
        status: "PENDING",
        passageId: passage.id,
        integrityToken,
        expiresAt,
      },
    });
  }

  return {
    sessionId: session.id,
    passage: {
      id: passage.id,
      content: passage.content,
      difficulty: passage.difficulty,
      wordCount: passage.wordCount,
      sourceAttribution: passage.sourceAttribution,
    },
    mode: session.mode,
    language: session.language,
    codeLanguage: session.codeLanguage || undefined,
    duration: session.duration,
    wordCount: session.wordCount,
    trustTier: session.trustTier,
    expiresAt: session.expiresAt.toISOString(),
    integrityToken: session.integrityToken, // Returned so client can use it to start/submit
  };
}

export async function startSession(params: StartSessionRequest) {
  // Use a transaction or atomic update to ensure it only starts once
  const now = new Date();
  const { getAuthenticatedUser } = await import("./auth.service");
  const user = await getAuthenticatedUser().catch(() => null);

  // Try atomic update
  const updatedSession = await db.testSession.updateMany({
    where: {
      id: params.sessionId,
      integrityToken: params.integrityToken,
      userId: user?.id ?? null,
      status: "PENDING",
      expiresAt: { gt: now },
    },
    data: {
      status: "ACTIVE",
      startedAt: now,
    },
  });

  if (updatedSession.count === 0) {
    // Find out why it failed to give a good error
    const session = await db.testSession.findUnique({ where: { id: params.sessionId } });
    if (!session) throw new Error("Session not found");
    if (session.status !== "PENDING")
      throw new Error(`Session is already ${session.status}`);
    if (session.expiresAt <= now) throw new Error("Session has expired");
    throw new Error("Failed to start session");
  }

  const session = await db.testSession.findUniqueOrThrow({
    where: { id: params.sessionId },
  });

  return {
    sessionId: session.id,
    status: session.status,
    startedAt: session.startedAt!.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function submitResult(params: SubmitResultRequest & { _isConcurrentReplay?: boolean }) {
  const now = new Date();

  const { getAuthenticatedUser } = await import("./auth.service");
  const user = await getAuthenticatedUser().catch(() => null);

  try {
    return await db.$transaction(async (tx) => {
    // 1. Retrieve session securely
    const session = await tx.testSession.findUnique({
      where: { id: params.sessionId },
      include: { passage: true },
    });

    if (!session) throw new Error("Session not found");
    if (session.integrityToken !== params.integrityToken)
      throw new Error("Invalid integrity token");
    if (session.trustTier === "B2B_ASSESSMENT") {
      const attempt = await tx.assessmentAttempt.findUnique({
        where: { sessionId: session.id },
        include: { candidate: { include: { assessment: true } } }
      });
      if (!attempt || !attempt.candidate || !attempt.candidate.assessment) {
        throw new Error("Invalid B2B session mapping");
      }
      if (attempt.candidateId !== attempt.candidate.id || attempt.candidate.assessmentId !== attempt.candidate.assessment.id) {
        throw new Error("Corrupted B2B assessment chain");
      }
    } else {
      if (session.userId !== (user?.id ?? null)) {
        throw new Error("Unauthorized to submit for this session");
      }
    }
    if (session.status !== "ACTIVE")
      throw new Error(`Session is not ACTIVE, currently ${session.status}`);
    if (!session.startedAt) throw new Error("Session has no startedAt time");

    // 2. Validate expiration / duration limit
    let expectedDurationMs = 0;
    if (session.duration) {
      expectedDurationMs = session.duration * 1000;
    }
    const serverElapsedMs = now.getTime() - session.startedAt.getTime();

    // Check if it's too late
    if (session.duration && serverElapsedMs > expectedDurationMs + GRACE_PERIOD_MS) {
      // Mark expired
      await tx.testSession.update({
        where: { id: session.id },
        data: { status: "EXPIRED" },
      });
      throw new Error("Session duration exceeded grace period");
    }

    if (session.expiresAt <= now) {
      await tx.testSession.update({
        where: { id: session.id },
        data: { status: "EXPIRED" },
      });
      throw new Error("Session has expired");
    }

    if (session.mode === "CODE") {
      if (params.codeLanguage && params.codeLanguage !== session.codeLanguage) {
        throw new Error("Mismatched code language in submission");
      }
    }

    // 3. Re-calculate metrics (strictly trust server elapsed time)
    let { correctChars, incorrectChars, totalChars, correctedErrors, uncorrectedErrors } =
      params.metrics;
    let wpm = 0,
      rawWpm = 0,
      netWpm = 0,
      accuracy = 0;

    const actualElapsedMs = serverElapsedMs;
    let scoringElapsedMs = actualElapsedMs;
    // Timed mode uses the fixed expected duration. Words mode uses the exact server measured time.
    if (session.mode === "TIMED" && expectedDurationMs > 0) {
      scoringElapsedMs = Math.min(actualElapsedMs, expectedDurationMs);
    }

    let integrityStatus: "VERIFIED" | "REVIEW" | "INVALID" = "VERIFIED";
    let scoringSource: "CLIENT_COUNTS" | "SERVER_RECONSTRUCTED" = "CLIENT_COUNTS";
    let traceHash: string | undefined = undefined;

    if (params._isConcurrentReplay) {
      integrityStatus = "INVALID";
      traceHash = undefined;
    } else if (params.eventTrace?.events && params.eventTrace.events.length > 0) {
      const traceString = JSON.stringify(params.eventTrace.events);
      // traceHash is an exact-replay detector, not proof of human-originated input.
      // It does NOT cryptographically authenticate the browser trace.
      traceHash = createHash("sha256").update(traceString).digest("hex");

      const existingTrace = await (tx.testResult as any).findFirst({
        where: { traceHash }
      });

      if (existingTrace) {

        integrityStatus = "INVALID";
        traceHash = undefined;
      } else {
        const { reconstructFinalBuffer } = await import("@/features/typing/lib/reconstruct");
        const rec = reconstructFinalBuffer(session.passage.content, params.eventTrace as any);

        if (rec.isValidTrace) {
          correctChars = rec.correctChars;
          incorrectChars = rec.incorrectChars;
          totalChars = rec.totalChars;
          correctedErrors = rec.correctedErrors;
          uncorrectedErrors = rec.uncorrectedErrors;
          scoringSource = "SERVER_RECONSTRUCTED";

          // Strictly use ACTUAL elapsed time for bounds checking
          if (rec.lastEventTimeMs > actualElapsedMs + 2000) {

            integrityStatus = session.trustTier === "FREE" ? "REVIEW" : "INVALID";
          } else if (session.mode === "TIMED" && expectedDurationMs > 0 && actualElapsedMs < expectedDurationMs - GRACE_PERIOD_MS && !rec.isPassageCompleted) {

            integrityStatus = session.trustTier === "FREE" ? "REVIEW" : "INVALID";
          } else {
            integrityStatus = "VERIFIED";
          }
        } else {

          integrityStatus = session.trustTier === "FREE" ? "REVIEW" : "INVALID";
        }
      }
    } else {

      integrityStatus = session.trustTier === "FREE" ? "REVIEW" : "INVALID";
      scoringSource = "CLIENT_COUNTS";
    }

    if (integrityStatus === "VERIFIED" || integrityStatus === "REVIEW") {
      wpm = calculateWpm(correctChars, scoringElapsedMs);
      rawWpm = calculateRawWpm(totalChars, scoringElapsedMs);
      accuracy = calculateAccuracy(correctChars, totalChars);
      netWpm = calculateNetWpm(wpm, uncorrectedErrors, scoringElapsedMs);

      if (wpm > 300 || accuracy < 0 || accuracy > 1) {


        integrityStatus = "INVALID";
      }
    } else {
      wpm = 0;
      rawWpm = 0;
      netWpm = 0;
      accuracy = 0;
    }

    if (params.integritySignals.pasteAttempts > 0) {

      integrityStatus = "INVALID";
    }


    // 4. Update session to completed (atomic)
    const updated = await tx.testSession.updateMany({
      where: { id: session.id, status: "ACTIVE" },
      data: {
        status: "COMPLETED",
        completedAt: now,
      },
    });

    if (updated.count === 0) {
      throw new Error("Session is not ACTIVE (concurrent submission detected)");
    }

    // 5. Create Result
    const shareId = randomBytes(10).toString("base64url");
    const claimToken = session.userId ? null : randomBytes(32).toString("hex");

    let codeMetrics: Prisma.InputJsonValue | undefined;
    if (session.mode === "CODE" && params.errorMap) {
      codeMetrics = calculateCodeMetrics(session.passage.content, params.errorMap) as any;
    }

    const result = await tx.testResult.create({
      data: {
        sessionId: session.id,
        userId: session.userId,
        shareId,
        wpm,
        rawWpm,
        netWpm,
        accuracy,
        consistency: params.metrics.consistency,
        correctChars,
        incorrectChars,
        totalChars,
        correctedErrors,
        uncorrectedErrors,
        totalKeystrokes: totalChars + correctedErrors,
        elapsedMs: actualElapsedMs,
        duration: session.duration,
        integrityStatus,
        scoringSource,
        integritySignals: params.integritySignals as Prisma.InputJsonValue,
        eventTrace: params.eventTrace as Prisma.InputJsonValue,
        traceHash: traceHash as any,
        ...(params.errorMap && { errorMap: params.errorMap }),
        ...(codeMetrics && { codeMetrics }),
        claimToken,
      },
    });

    if (session.trustTier === "B2B_ASSESSMENT") {
      const attempt = await tx.assessmentAttempt.findUnique({
        where: { sessionId: session.id },
      });
      if (attempt) {
        if (integrityStatus === "VERIFIED" && scoringSource === "SERVER_RECONSTRUCTED") {
          await tx.assessmentAttempt.update({
            where: { id: attempt.id },
            data: { status: "COMPLETED", completedAt: now },
          });
          await tx.assessmentCandidate.update({
            where: { id: attempt.candidateId },
            data: { status: "COMPLETED", resultId: result.id, updatedAt: now },
          });
          await tx.auditLog.create({
            data: {
              action: "RESULT_COMPLETED",
              resource: "TestResult",
              resourceId: result.id,
              metadata: { candidateId: attempt.candidateId, attemptId: attempt.id },
            },
          });
        } else if (integrityStatus === "INVALID") {
        await tx.assessmentAttempt.update({
          where: { id: attempt.id },
          data: { status: "INVALIDATED", completedAt: now },
        });
        await tx.assessmentCandidate.update({
          where: { id: attempt.candidateId },
          data: { status: "DISQUALIFIED", resultId: result.id, updatedAt: now },
        });
      }
      }
    }

    return {
      resultId: result.id,
      shareId: result.shareId,
      shareUrl: `/result/${result.shareId}`,
      integrityStatus: result.integrityStatus,
      wpm: result.wpm,
      accuracy: result.accuracy,
      claimToken,
    };
  });
  } catch (error: any) {
    if (error.code === "P2002" && (error.meta?.target?.includes("traceHash") || error.meta?.target?.includes("trace_hash"))) {
      // Concurrent duplicate submission hit the unique constraint.
      // Recursively call with a flag to explicitly reject it and preserve transaction semantics.
      return submitResult({ ...params, _isConcurrentReplay: true });
    }
    throw error;
  }
}
