import { z } from "zod";
import {
  TYPING_MODES,
  LANGUAGES,
  CODE_LANGUAGES,
  TEST_DURATIONS,
  CERTIFICATE_MIN_DURATION,
} from "@/lib/constants";

/**
 * Whether a create-session request asks for the CERTIFICATE tier. The public
 * certificate page sends trustTier "CERTIFICATE"; certificateMode is the older
 * flag. Both mean the same thing.
 */
export function requestsCertificateTier(data: {
  certificateMode?: boolean | undefined;
  trustTier?: string | undefined;
}): boolean {
  return data.certificateMode === true || data.trustTier === "CERTIFICATE";
}

export const CreateSessionSchema = z
  .object({
    mode: z.enum(TYPING_MODES),
    language: z.enum(LANGUAGES),
    codeLanguage: z.enum(CODE_LANGUAGES).optional(),
    duration: z.number().int().positive().optional(),
    wordCount: z.number().int().positive().optional(),
    certificateMode: z.boolean().optional(),
    trustTier: z.enum(["FREE", "CERTIFICATE", "B2B_ASSESSMENT"]).optional(),
    inviteToken: z.string().optional(),
    attemptId: z.string().uuid().optional(),
    sourceResultId: z.string().uuid().optional(), // Used for deriving practice weak keys
  })
  .refine(
    (data) => {
      if (data.mode === "timed" && !data.duration) return false;
      if (data.mode === "words" && !data.wordCount) return false;
      return true;
    },
    {
      message: "Duration is required for timed mode, wordCount for words mode",
    }
  )
  .refine(
    // Only the standard durations the product offers. B2B invite sessions are
    // exempt: createSession replaces their duration with the assessment's own.
    // The condition must match createSession's B2B branch exactly.
    (data) =>
      (data.inviteToken !== undefined && data.attemptId !== undefined) ||
      data.duration === undefined ||
      (TEST_DURATIONS as readonly number[]).includes(data.duration),
    {
      message: `Duration must be one of ${TEST_DURATIONS.join(", ")} seconds`,
      path: ["duration"],
    }
  )
  .refine(
    // A certificate test is a timed test at least as long as the certificate
    // minimum; anything shorter could never be certificate-eligible.
    (data) =>
      !requestsCertificateTier(data) ||
      (data.mode === "timed" &&
        data.duration !== undefined &&
        data.duration >= CERTIFICATE_MIN_DURATION),
    {
      message: `Certificate tests must be timed tests of at least ${CERTIFICATE_MIN_DURATION} seconds`,
      path: ["duration"],
    }
  )
  .refine(
    // The B2B tier is granted only by a valid invite + attempt in
    // createSession, never by a client-supplied trustTier.
    (data) =>
      data.trustTier !== "B2B_ASSESSMENT" ||
      (data.inviteToken !== undefined && data.attemptId !== undefined),
    {
      message: "B2B assessment sessions require an invite and an attempt",
      path: ["trustTier"],
    }
  );

export type CreateSessionRequest = z.infer<typeof CreateSessionSchema>;

export const StartSessionSchema = z.object({
  sessionId: z.string().uuid(),
  integrityToken: z.string().min(1),
});

export type StartSessionRequest = z.infer<typeof StartSessionSchema>;
