/**
 * Environment variable validation.
 *
 * Validates all env vars at server startup using Zod.
 * - Server-side secrets are never exposed to the client.
 * - Client-side vars must be prefixed with NEXT_PUBLIC_.
 * - If any required var is missing, the app fails fast with a clear message.
 */
import { z } from "zod";
import { assertEnvironmentIsolation } from "./environmentGuard";

// ─── Server-side environment schema ──────────────────────────────────────────
const serverSchema = z
  .object({
    // Supabase
    SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
    SUPABASE_ANON_KEY: z.string().min(1, "SUPABASE_ANON_KEY is required"),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),

    // Database
    DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),
    DIRECT_URL: z.string().url("DIRECT_URL must be a valid connection URL"),

    // Razorpay
    RAZORPAY_KEY_ID: z.string().min(1, "RAZORPAY_KEY_ID is required"),
    RAZORPAY_KEY_SECRET: z.string().min(1, "RAZORPAY_KEY_SECRET is required"),
    RAZORPAY_WEBHOOK_SECRET: z.string().min(1, "RAZORPAY_WEBHOOK_SECRET is required"),
    /// Optional: Razorpay Plan ID for Pro Monthly subscription
    RAZORPAY_PLAN_ID_PRO_MONTHLY: z.string().optional(),
    /// Optional: Razorpay Plan ID for Pro Yearly subscription
    RAZORPAY_PLAN_ID_PRO_YEARLY: z.string().optional(),

    // App
    APP_URL: z
      .string()
      .url("APP_URL must be a valid URL")
      .default("http://localhost:3000"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // Integrity
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    /// Signs certificate verificationHash values. Separate from SESSION_SECRET so
    /// issued certificates stay verifiable independently of session-secret rotation.
    CERTIFICATE_SIGNING_SECRET: z
      .string()
      .min(32, "CERTIFICATE_SIGNING_SECRET must be at least 32 characters"),

    // Redis
    REDIS_URL: z.string().url("REDIS_URL must be a valid URL").optional(),
    TEST_REDIS_URL: z.string().url("TEST_REDIS_URL must be a valid URL").optional(),

    /// Non-production only: the production Supabase project ref (public, not a
    /// secret), so a remote non-production database or Supabase URL can be shown
    /// not to be production. Checked by src/lib/environmentGuard.ts.
    PRODUCTION_SUPABASE_PROJECT_REF: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.CERTIFICATE_SIGNING_SECRET === data.SESSION_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CERTIFICATE_SIGNING_SECRET must differ from SESSION_SECRET.",
        path: ["CERTIFICATE_SIGNING_SECRET"],
      });
    }
    if (data.NODE_ENV === "production") {
      if (!data.REDIS_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "REDIS_URL is required in production.",
          path: ["REDIS_URL"],
        });
      } else if (!data.REDIS_URL.startsWith("rediss://")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Production REDIS_URL must use rediss://",
          path: ["REDIS_URL"],
        });
      }
    }
  });

// ─── Client-side environment schema ──────────────────────────────────────────
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_RAZORPAY_KEY_ID: z.string().min(1),
});

// ─── Parse & validate ─────────────────────────────────────────────────────────
function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  data: Record<string, string | undefined>,
  label: string
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const formatted = result.error.format();
    console.error(
      `\n❌ Invalid ${label} environment variables:\n`,
      JSON.stringify(formatted, null, 2)
    );
    throw new Error(`Invalid ${label} environment variables. See above.`);
  }
  return result.data as z.infer<T>;
}

// Server env — only accessible in server context
// We use a lazy getter so client bundle never imports this branch
let _serverEnv: z.infer<typeof serverSchema> | undefined;

export function getServerEnv(): z.infer<typeof serverSchema> {
  if (typeof window !== "undefined") {
    throw new Error(
      "getServerEnv() must not be called from client-side code. " +
        "Use clientEnv instead."
    );
  }
  if (!_serverEnv) {
    const parsed = parseEnv(
      serverSchema,
      {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        DATABASE_URL: process.env.DATABASE_URL,
        DIRECT_URL: process.env.DIRECT_URL,
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
        RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
        RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
        RAZORPAY_PLAN_ID_PRO_MONTHLY: process.env.RAZORPAY_PLAN_ID_PRO_MONTHLY,
        RAZORPAY_PLAN_ID_PRO_YEARLY: process.env.RAZORPAY_PLAN_ID_PRO_YEARLY,
        APP_URL: process.env.APP_URL,
        NODE_ENV: process.env.NODE_ENV,
        SESSION_SECRET: process.env.SESSION_SECRET,
        CERTIFICATE_SIGNING_SECRET: process.env.CERTIFICATE_SIGNING_SECRET,
        REDIS_URL: process.env.REDIS_URL,
        TEST_REDIS_URL: process.env.TEST_REDIS_URL,
        PRODUCTION_SUPABASE_PROJECT_REF: process.env.PRODUCTION_SUPABASE_PROJECT_REF,
      },
      "server"
    );
    // Fails closed before anything uses these credentials: a non-production
    // runtime must not run against production infrastructure.
    assertEnvironmentIsolation(process.env);
    _serverEnv = parsed;
  }
  return _serverEnv;
}

// ─── Supabase auth environment (middleware / session refresh) ────────────────
// Middleware and the cookie-bound Supabase server client only need the
// Supabase URL + anon key. They must not depend on the full server schema,
// otherwise an unrelated bad variable (DB, Razorpay, Redis, ...) takes down
// every request. Not cached, so a fixed env is picked up without a restart;
// parsing two strings per call is negligible.
const supabaseAuthSchema = z.object({
  SUPABASE_URL: serverSchema.innerType().shape.SUPABASE_URL,
  SUPABASE_ANON_KEY: serverSchema.innerType().shape.SUPABASE_ANON_KEY,
});

export function getSupabaseAuthEnv(): z.infer<typeof supabaseAuthSchema> {
  if (typeof window !== "undefined") {
    throw new Error("getSupabaseAuthEnv() must not be called from client-side code.");
  }
  return parseEnv(
    supabaseAuthSchema,
    {
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    },
    "Supabase auth"
  );
}

// Client env — safe to expose; only NEXT_PUBLIC_ vars
// Lazy singleton to avoid module-load failures when env vars aren't set yet
let _clientEnv: z.infer<typeof clientSchema> | undefined;

export function getClientEnv(): z.infer<typeof clientSchema> {
  if (!_clientEnv) {
    _clientEnv = parseEnv(
      clientSchema,
      {
        NEXT_PUBLIC_SUPABASE_URL: process.env["NEXT_PUBLIC_SUPABASE_URL"],
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
        NEXT_PUBLIC_APP_URL: process.env["NEXT_PUBLIC_APP_URL"],
        NEXT_PUBLIC_RAZORPAY_KEY_ID: process.env["NEXT_PUBLIC_RAZORPAY_KEY_ID"],
      },
      "client"
    );
  }
  return _clientEnv;
}

export function __clearServerEnvForTesting() {
  _serverEnv = undefined;
}

/** @deprecated Use getClientEnv() instead */
export const clientEnv = new Proxy({} as z.infer<typeof clientSchema>, {
  get(_target, prop) {
    return getClientEnv()[prop as keyof z.infer<typeof clientSchema>];
  },
});
