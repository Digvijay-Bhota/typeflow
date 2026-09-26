/**
 * An expected, client-attributable failure raised by a service.
 *
 * Route handlers map it directly to `{ error: { code, message } }` with
 * `status`, instead of matching on error message text. Anything that is not a
 * ServiceError is an unexpected failure and must stay a generic 5xx.
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

/** Prisma unique-constraint violation (P2002) on the given field. */
export function isUniqueViolation(error: unknown, field: string): boolean {
  const e = error as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  return Array.isArray(target)
    ? target.includes(field)
    : String(target ?? "").includes(field);
}
