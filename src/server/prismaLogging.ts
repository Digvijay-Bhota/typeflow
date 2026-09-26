/**
 * Prisma warn/error events → structured logs, in every environment.
 *
 * Prisma emits an "error" event for every failed query, in addition to
 * throwing it to the caller. The raw event message is unsafe and noisy to
 * log as-is: it embeds a source code frame, and for validation errors a
 * dump of the query arguments (i.e. row values). So only a summary is
 * logged: the explanatory lines, without the frame or the argument tree,
 * redacted and truncated. Query parameters are never logged.
 *
 * Unique-constraint and record-not-found failures are expected outcomes the
 * services handle (idempotency, compare-and-set, races); they are not
 * logged here. Every failure still reaches its caller, which logs what it
 * does not handle.
 */
import { logger, redactString } from "@/lib/logger";

export type PrismaLogEvent = { message: string; target?: string | undefined };

const MAX_SUMMARY = 500;

const EXPECTED_ERRORS = [
  /Unique constraint failed/i,
  /required but not found|No record was found/i,
];

/** The event's explanatory lines, without the invocation, code frame or arguments. */
export function summarizePrismaMessage(message: string): string {
  const lines = message
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^\s/.test(line) && // code frame and argument tree lines are indented
        !/^→/.test(line) && // highlighted code frame line
        !/^Invalid `[^`]+` invocation/.test(line) &&
        !/^(\/|[A-Za-z]:\\|file:\/\/|webpack:)/.test(line) // call-site path
    );
  const summary = redactString(lines.join(" "));
  return summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY)}…` : summary;
}

export function isExpectedPrismaError(message: string): boolean {
  return EXPECTED_ERRORS.some((pattern) => pattern.test(message));
}

export function logPrismaWarn(event: PrismaLogEvent): void {
  logger.warn("Prisma warning", {
    prisma: { target: event.target, message: summarizePrismaMessage(event.message) },
  });
}

export function logPrismaError(event: PrismaLogEvent): void {
  if (isExpectedPrismaError(event.message)) return;
  logger.error("Prisma error", undefined, {
    prisma: { target: event.target, message: summarizePrismaMessage(event.message) },
  });
}
