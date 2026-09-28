/**
 * Environment isolation guard.
 *
 * A non-production runtime (a Vercel preview or development deployment, or a
 * local `next dev`) must never operate against production infrastructure:
 * the production database/Supabase project, live Razorpay keys, or the
 * production app URL. The guard fails closed — it throws before the app
 * touches the database, Redis or Razorpay — and its errors name the offending
 * variables, never their values.
 *
 * The production Supabase project is identified by PRODUCTION_SUPABASE_PROJECT_REF
 * (a public project reference, not a secret). Without it, a non-production
 * database URL is accepted only when it is local, because nothing else proves
 * that it is not production.
 *
 * Pure and dependency-free (no path aliases): also loaded by
 * src/server/lib/redis.ts outside the Next.js bundler.
 */

export type DeploymentEnvironment = "production" | "preview" | "development" | "test";

type Env = Record<string, string | undefined>;

/**
 * Where this process runs. On Vercel, VERCEL_ENV decides, and any value other
 * than "production" or "development" (e.g. a custom environment) counts as a
 * preview. Elsewhere NODE_ENV decides: `next dev` is development, a production
 * build or `next start` is production, and vitest is test.
 */
export function deploymentEnvironment(env: Env): DeploymentEnvironment {
  const vercelEnv = env.VERCEL_ENV?.trim();
  if (vercelEnv) {
    if (vercelEnv === "production") return "production";
    if (vercelEnv === "development") return "development";
    return "preview";
  }
  if (env.NODE_ENV === "test") return "test";
  if (env.NODE_ENV === "production") return "production";
  return "development";
}

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
  "host.docker.internal",
]);

/** A Supabase project reference: 20 lowercase letters and digits. */
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

const DATABASE_VARS = ["DATABASE_URL", "DIRECT_URL"] as const;
const SUPABASE_VARS = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"] as const;
const RAZORPAY_KEY_VARS = ["RAZORPAY_KEY_ID", "NEXT_PUBLIC_RAZORPAY_KEY_ID"] as const;
const APP_URL_VARS = ["APP_URL", "NEXT_PUBLIC_APP_URL"] as const;

export type IsolationViolation = { variable: string; problem: string };

/** Thrown when a non-production runtime is configured with production infrastructure. */
export class EnvironmentIsolationError extends Error {
  constructor(
    readonly environment: DeploymentEnvironment,
    readonly violations: IsolationViolation[]
  ) {
    // "Configuration Error" makes rateLimit() rethrow instead of failing
    // closed silently, so a misconfigured deployment fails loudly.
    super(
      `Configuration Error: refusing to run a ${environment} deployment against production ` +
        `infrastructure (see ARCHITECTURE.md, "Environment Isolation"):\n` +
        violations.map((v) => `  - ${v.variable}: ${v.problem}`).join("\n")
    );
    this.name = "EnvironmentIsolationError";
  }
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** Local by hostname, and not redirected elsewhere by a libpq host/hostaddr parameter. */
function isLocal(url: URL): boolean {
  if (url.searchParams.has("host") || url.searchParams.has("hostaddr")) return false;
  return LOCAL_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Whether a URL names the given Supabase project: in its host
 * (`<ref>.supabase.co`, `db.<ref>.supabase.co`) or its user (`postgres.<ref>`,
 * the connection pooler's form). The password is never inspected.
 */
function referencesProject(url: URL, projectRef: string): boolean {
  const user = decodeURIComponent(url.username).toLowerCase();
  return url.hostname.toLowerCase().includes(projectRef) || user.includes(projectRef);
}

/** Hostname of the production deployment, from Vercel's system variable. */
function productionHost(env: Env): string | null {
  const raw = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (!raw) return null;
  return (
    parseUrl(raw.includes("://") ? raw : `https://${raw}`)?.hostname.toLowerCase() ?? null
  );
}

/** The isolation problems of a configuration; empty in production and test. */
export function environmentIsolationViolations(env: Env): IsolationViolation[] {
  const environment = deploymentEnvironment(env);
  if (environment === "production" || environment === "test") return [];

  const violations: IsolationViolation[] = [];
  const deployed = Boolean(env.VERCEL || env.VERCEL_ENV);

  const rawRef = env.PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase() || null;
  if (rawRef && !PROJECT_REF_PATTERN.test(rawRef)) {
    violations.push({
      variable: "PRODUCTION_SUPABASE_PROJECT_REF",
      problem: "is not a Supabase project reference (20 lowercase letters and digits)",
    });
  }
  const productionRef = rawRef && PROJECT_REF_PATTERN.test(rawRef) ? rawRef : null;

  // Databases: fail closed. Only a local database, or one shown not to be the
  // production project, is accepted.
  for (const name of DATABASE_VARS) {
    const raw = env[name];
    if (!raw) continue;
    const url = parseUrl(raw);
    if (!url) {
      violations.push({ variable: name, problem: "is not a valid URL" });
    } else if (isLocal(url)) {
      continue;
    } else if (!productionRef) {
      violations.push({
        variable: name,
        problem:
          "points to a remote database, and PRODUCTION_SUPABASE_PROJECT_REF is not set, " +
          "so it cannot be shown not to be production. Use a local database, or set " +
          "PRODUCTION_SUPABASE_PROJECT_REF",
      });
    } else if (referencesProject(url, productionRef)) {
      violations.push({
        variable: name,
        problem: "points to the production Supabase project",
      });
    }
  }

  // Supabase API (Auth, Storage): never the production project. Deployed
  // non-production runtimes fail closed like the database; local development
  // may still use a remote project when the production ref is not declared.
  for (const name of SUPABASE_VARS) {
    const raw = env[name];
    if (!raw) continue;
    const url = parseUrl(raw);
    if (!url) {
      violations.push({ variable: name, problem: "is not a valid URL" });
    } else if (isLocal(url)) {
      continue;
    } else if (productionRef) {
      if (referencesProject(url, productionRef)) {
        violations.push({
          variable: name,
          problem: "points to the production Supabase project",
        });
      }
    } else if (deployed) {
      violations.push({
        variable: name,
        problem:
          "points to a remote Supabase project, and PRODUCTION_SUPABASE_PROJECT_REF is not " +
          "set, so it cannot be shown not to be production",
      });
    }
  }

  // Razorpay: Test Mode keys only.
  for (const name of RAZORPAY_KEY_VARS) {
    const raw = env[name]?.trim();
    if (raw && !raw.startsWith("rzp_test_")) {
      violations.push({
        variable: name,
        problem: "is not a Razorpay Test Mode key (rzp_test_…)",
      });
    }
  }

  // App URL: never the production domain Vercel reports for this project.
  // Branch and deployment preview URLs are different hosts and pass.
  const prodHost = productionHost(env);
  if (prodHost) {
    for (const name of APP_URL_VARS) {
      const raw = env[name];
      if (!raw) continue;
      if (parseUrl(raw)?.hostname.toLowerCase() === prodHost) {
        violations.push({ variable: name, problem: "is the production URL" });
      }
    }
  }

  return violations;
}

/** Throws EnvironmentIsolationError when a non-production runtime uses production infrastructure. */
export function assertEnvironmentIsolation(env: Env): void {
  const violations = environmentIsolationViolations(env);
  if (violations.length > 0) {
    throw new EnvironmentIsolationError(deploymentEnvironment(env), violations);
  }
}
