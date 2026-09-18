import { randomBytes, createHash } from "crypto";
import { Language, TypingMode, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { CreateSessionRequest, StartSessionRequest } from "@/schemas/session.schema";
import { SubmitResultRequest } from "@/schemas/result.schema";
import { 
  calculateWpm, 
  calculateRawWpm, 
  calculateNetWpm, 
  calculateAccuracy
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
      where: { inviteTokenHash: createHash("sha256").update(params.inviteToken).digest("hex") },
      include: { assessment: true },
    });
    
    if (!candidate || candidate.assessment.status !== "PUBLISHED") {
      throw new Error("INVALID_OR_CLOSED_ASSESSMENT");
    }

    const attempt = await db.assessmentAttempt.findUnique({
      where: { id: params.attemptId },
    });

    if (!attempt || attempt.candidateId !== candidate.id || attempt.status !== "STARTED") {
      throw new Error("INVALID_ATTEMPT");
    }
    
    trustTier = "B2B_ASSESSMENT";
    b2bAttemptId = attempt.id;
    
    // Server overrides candidate settings
    params.mode = candidate.assessment.testMode === "CODE" ? "code" : "timed";
    params.language = candidate.assessment.language.toLowerCase() as any;
    if (params.mode === "code") {
      params.codeLanguage = candidate.assessment.codeLanguage?.toLowerCase() as any;
    }
    params.duration = candidate.assessment.duration;
  }

  const { getAuthenticatedUser } = await import("./auth.service");
  const user = await getAuthenticatedUser();

  
  const passages = await db.passage.findMany({
    where: {
      language: params.language.toUpperCase() as Language,
      ...(params.mode === "code" && params.codeLanguage ? { codeLanguage: params.codeLanguage.toUpperCase() as any } : {}),
      isActive: true,
      mode: params.certificateMode ? "CERTIFICATE" : "NORMAL",
    }
  });

  if (passages.length === 0) {
    throw new Error("No passages found for the requested criteria");
  }

  const passage = passages[Math.floor(Math.random() * passages.length)] as any;

  const integrityToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_VALIDITY_MS);

  const session = await db.testSession.create({
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

  if (b2bAttemptId) {
    await db.assessmentAttempt.update({
      where: { id: b2bAttemptId },
      data: { sessionId: session.id },
    });
  }

  return {
    sessionId: session.id,
    passage: {
      id: passage.id,
      content: passage.content,
      difficulty: passage.difficulty,
      wordCount: passage.wordCount,
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
  const user = await getAuthenticatedUser();

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
    if (session.status !== "PENDING") throw new Error(`Session is already ${session.status}`);
    if (session.expiresAt <= now) throw new Error("Session has expired");
    throw new Error("Failed to start session");
  }

  const session = await db.testSession.findUniqueOrThrow({ where: { id: params.sessionId } });

  return {
    sessionId: session.id,
    status: session.status,
    startedAt: session.startedAt!.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function submitResult(params: SubmitResultRequest) {
  const now = new Date();

  const { getAuthenticatedUser } = await import("./auth.service");
  const user = await getAuthenticatedUser();

  return await db.$transaction(async (tx) => {
    // 1. Retrieve session securely
    const session = await tx.testSession.findUnique({
      where: { id: params.sessionId },
      include: { passage: true },
    });

    if (!session) throw new Error("Session not found");
    if (session.integrityToken !== params.integrityToken) throw new Error("Invalid integrity token");
    if (session.userId !== (user?.id ?? null)) throw new Error("Unauthorized to submit for this session");
    if (session.status !== "ACTIVE") throw new Error(`Session is not ACTIVE, currently ${session.status}`);
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
      await tx.testSession.update({ where: { id: session.id }, data: { status: "EXPIRED" } });
      throw new Error("Session duration exceeded grace period");
    }

    if (session.expiresAt <= now) {
      await tx.testSession.update({ where: { id: session.id }, data: { status: "EXPIRED" } });
      throw new Error("Session has expired");
    }

    if (session.mode === "CODE") {
      if (params.codeLanguage && params.codeLanguage !== session.codeLanguage) {
        throw new Error("Mismatched code language in submission");
      }
    }

    // 3. Re-calculate metrics (strictly trust server elapsed time)
    let { correctChars, incorrectChars, totalChars, correctedErrors, uncorrectedErrors } = params.metrics;
    let wpm = 0, rawWpm = 0, netWpm = 0, accuracy = 0;
    
    let finalElapsedMs = serverElapsedMs;
    // Timed mode uses the fixed expected duration. Words mode uses the exact server measured time.
    // clientElapsedMs is completely ignored for timing WPM.
    if (session.mode === "TIMED" && expectedDurationMs > 0) {
      finalElapsedMs = expectedDurationMs;
    }

    let integrityStatus: "VERIFIED" | "REVIEW" | "INVALID" = "VERIFIED";

    if (session.trustTier === "CERTIFICATE" || session.trustTier === "B2B_ASSESSMENT") {
      const { verifyCertificateTest } = await import("./certificateVerification.service");
      if (!params.eventTrace?.events) {
        integrityStatus = "INVALID";
      } else {
        const verification = verifyCertificateTest(session.passage.content, params.eventTrace.events as [number, number, number, string?][], finalElapsedMs);
        if (verification.status === "VERIFIED" && verification.reconstructed) {
          correctChars = verification.reconstructed.correctChars;
          incorrectChars = verification.reconstructed.incorrectChars;
          totalChars = verification.reconstructed.totalChars;
          correctedErrors = verification.reconstructed.correctedErrors;
          uncorrectedErrors = verification.reconstructed.uncorrectedErrors;
          wpm = verification.reconstructed.wpm;
          rawWpm = verification.reconstructed.rawWpm;
          netWpm = verification.reconstructed.netWpm;
          accuracy = verification.reconstructed.accuracy;
          integrityStatus = "VERIFIED";
        } else {
          integrityStatus = verification.status;
          wpm = 0; rawWpm = 0; netWpm = 0; accuracy = 0;
        }
      }
    } else {
      wpm = calculateWpm(correctChars, finalElapsedMs);
      rawWpm = calculateRawWpm(totalChars, finalElapsedMs);
      accuracy = calculateAccuracy(correctChars, totalChars);
      netWpm = calculateNetWpm(wpm, uncorrectedErrors, finalElapsedMs);
      
      // Basic sanity checks for FREE tier
      if (wpm > 300 || accuracy < 0 || accuracy > 1) {
        integrityStatus = "INVALID";
      }
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
        elapsedMs: finalElapsedMs,
        duration: session.duration,
        integrityStatus,
        integritySignals: params.integritySignals as Prisma.InputJsonValue,
        eventTrace: params.eventTrace as Prisma.InputJsonValue,
        ...(params.errorMap && { errorMap: params.errorMap }),
        ...(codeMetrics && { codeMetrics }),
        claimToken,
      },
    });

    if (session.trustTier === "B2B_ASSESSMENT") {
      const attempt = await tx.assessmentAttempt.findUnique({
        where: { sessionId: session.id }
      });
      if (attempt) {
        await tx.assessmentAttempt.update({
          where: { id: attempt.id },
          data: { status: "COMPLETED", completedAt: now }
        });
        await tx.assessmentCandidate.update({
          where: { id: attempt.candidateId },
          data: { status: "COMPLETED", resultId: result.id, updatedAt: now }
        });
        await tx.auditLog.create({
          data: {
            action: "RESULT_COMPLETED",
            resource: "TestResult",
            resourceId: result.id,
            metadata: { candidateId: attempt.candidateId, attemptId: attempt.id }
          }
        });
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
}
