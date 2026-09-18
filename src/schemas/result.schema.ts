import { z } from "zod";

const MetricsSchema = z.object({
  wpm: z.number().nonnegative(),
  rawWpm: z.number().nonnegative(),
  accuracy: z.number().min(0).max(1),
  correctChars: z.number().int().nonnegative(),
  incorrectChars: z.number().int().nonnegative(),
  totalChars: z.number().int().nonnegative(),
  correctedErrors: z.number().int().nonnegative(),
  uncorrectedErrors: z.number().int().nonnegative(),
  consistency: z.number().nullable(),
});

const IntegritySignalsSchema = z.object({
  pasteAttempts: z.number().int().nonnegative(),
  copyAttempts: z.number().int().nonnegative(),
  focusLossCount: z.number().int().nonnegative(),
  visibilityChanges: z.number().int().nonnegative(),
  suspiciousPattern: z.boolean(),
  intervalWpms: z.array(z.number().nonnegative()),
  selectionAttempts: z.number().int().nonnegative(),
});

/**
 * Compact event trace format for high-trust verification.
 * Format: array of [timestampOffsetMs, eventType (0=char, 1=backspace), expectedIndex, typedChar]
 */
const EventTraceSchema = z.object({
  events: z.array(z.tuple([
    z.number().int().nonnegative(), // offset from start in ms
    z.number().int().min(0).max(1), // type: 0=char, 1=backspace
    z.number().int().nonnegative(), // position index
    z.string().optional(), // typed character (for type 0)
  ])).max(12000), // Max realistic keystrokes for a 5-minute test at 300 WPM
  totalEvents: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

export const SubmitResultSchema = z.object({
  sessionId: z.string().uuid(),
  metrics: MetricsSchema,
  integritySignals: IntegritySignalsSchema,
  eventTrace: EventTraceSchema.optional(),
  errorMap: z.record(z.string(), z.any()).optional(),
  clientElapsedMs: z.number().int().nonnegative().optional(),
  codeLanguage: z.string().optional(),
  integrityToken: z.string(),
});

export type SubmitResultRequest = z.infer<typeof SubmitResultSchema>;
