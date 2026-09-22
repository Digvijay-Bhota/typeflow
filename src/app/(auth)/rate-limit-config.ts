/**
 * Rate-limit thresholds for the auth server actions (src/app/(auth)/actions.ts).
 *
 * Kept in a plain module rather than exported from actions.ts because
 * Next.js only allows async function exports from a "use server" file —
 * every export there becomes a serializable Server Action reference, and a
 * plain numeric constant violates that contract at build time.
 */
export const LOGIN_IP_LIMIT = 20;
export const LOGIN_EMAIL_LIMIT = 5;
export const SIGNUP_IP_LIMIT = 10;
export const SIGNUP_EMAIL_LIMIT = 3;
