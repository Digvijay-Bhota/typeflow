/**
 * Authorization for the /api/cron/* routes: `Authorization: Bearer
 * <CRON_SECRET>` (what Vercel Cron sends), compared in constant time.
 *
 * A route answers 503 when the secret is unset or shorter than
 * MIN_CRON_SECRET_LENGTH (cronSecretConfigured), and 401 when the header does
 * not match (isCronAuthorized).
 */
import { createHash, timingSafeEqual } from "crypto";

export const MIN_CRON_SECRET_LENGTH = 32;

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Whether CRON_SECRET is set and long enough to be accepted at all. */
export function cronSecretConfigured(secret: string | undefined): secret is string {
  return !!secret && secret.length >= MIN_CRON_SECRET_LENGTH;
}

/** Constant-time: both sides are hashed to the same length first. */
export function isCronAuthorized(header: string | null, secret: string): boolean {
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}
