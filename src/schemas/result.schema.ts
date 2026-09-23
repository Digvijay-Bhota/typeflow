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
  consistency: z.number().min(0).max(1).nullable(),
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

const KeypressEvent = z.tuple([
  z.number().int().nonnegative(),
  z.literal(0),
  z.number().int().nonnegative(),
  z.string().max(1),
]);

const BackspaceEvent = z.tuple([
  z.number().int().nonnegative(),
  z.literal(1),
  z.number().int().nonnegative(),
]);

const EventTuple = z.union([KeypressEvent, BackspaceEvent]);

/**
 * Compact event trace format for high-trust verification.
 */
const EventTraceSchema = z.object({
  events: z.array(EventTuple).max(12000),
  totalEvents: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

export type EventTrace = z.infer<typeof EventTraceSchema>;

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
