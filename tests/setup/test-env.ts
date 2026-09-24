/**
 * Vitest setupFiles entry — fills in placeholder values for the non-database
 * server env vars that `getServerEnv()` validates, so `npm run test` is
 * self-contained locally.
 *
 * Values mirror the test-only placeholders CI passes to the test step in
 * .github/workflows/ci.yml. They are NOT secrets and must never be real
 * credentials. A variable is only filled when it is unset, so anything the
 * environment (CI, a test, a developer shell) already provides wins.
 *
 * Runs before any test file is imported, and therefore before Prisma's .env
 * auto-load — which never overrides an already-set variable — so a local .env
 * cannot leak real values into the test run for these keys.
 */
const TEST_ENV_PLACEHOLDERS: Record<string, string> = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "test-only-supabase-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-supabase-service-role-key",
  RAZORPAY_KEY_ID: "rzp_test_placeholder",
  RAZORPAY_KEY_SECRET: "test-only-razorpay-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "test-only-razorpay-webhook-secret",
  SESSION_SECRET: "test-only-session-secret-not-for-production",
  CERTIFICATE_SIGNING_SECRET: "test-only-certificate-signing-secret-not-for-production",
};

for (const [key, value] of Object.entries(TEST_ENV_PLACEHOLDERS)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
