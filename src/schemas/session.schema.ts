import { z } from "zod";
import { TYPING_MODES, LANGUAGES, CODE_LANGUAGES } from "@/lib/constants";

export const CreateSessionSchema = z.object({
  mode: z.enum(TYPING_MODES),
  language: z.enum(LANGUAGES),
  codeLanguage: z.enum(CODE_LANGUAGES).optional(),
  duration: z.number().int().positive().optional(),
  wordCount: z.number().int().positive().optional(),
  certificateMode: z.boolean().optional(),
  trustTier: z.enum(["FREE", "CERTIFICATE", "B2B_ASSESSMENT"]).optional(),
  inviteToken: z.string().optional(),
  attemptId: z.string().uuid().optional(),
}).refine((data) => {
  if (data.mode === "timed" && !data.duration) return false;
  if (data.mode === "words" && !data.wordCount) return false;
  return true;
}, {
  message: "Duration is required for timed mode, wordCount for words mode",
});

export type CreateSessionRequest = z.infer<typeof CreateSessionSchema>;

export const StartSessionSchema = z.object({
  sessionId: z.string().uuid(),
  integrityToken: z.string().min(1),
});

export type StartSessionRequest = z.infer<typeof StartSessionSchema>;
