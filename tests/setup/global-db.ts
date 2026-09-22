/**
 * Vitest globalSetup — runs exactly once, before any test file is
 * collected, in a SEPARATE process/context from setupFiles
 * (tests/setup/db-env.ts). Mutations that file makes to process.env are
 * NOT guaranteed to be visible here, so this file independently resolves
 * and validates the test database URL from scratch before touching
 * Prisma at all. The parsing/validation logic below is intentionally
 * duplicated from db-env.ts rather than imported, so this guard never
 * depends on load order between the two contexts.
 *
 * Responsibilities:
 *   1. Resolve + validate DATABASE_URL/DIRECT_URL (same rules as db-env.ts).
 *   2. Apply committed Prisma migrations to the (already-validated) test DB.
 *   3. Truncate all application tables so every test run starts clean,
 *      regardless of whether the previous run's cleanup hooks succeeded.
 *
 * This file must never touch a remote database. The safety assertions
 * below make that failure mode impossible rather than merely unlikely.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const REPO_ROOT = resolve(__dirname, "../..");
const TEST_ENV_PATH = resolve(REPO_ROOT, ".env.test");
const REQUIRED_DB_NAME = "typeflow_test";
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function assertSafeTestDatabaseUrl(name: string, raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `[global-db] ${name} is not a valid connection URL. Refusing to run tests.`
    );
  }

  const host = url.hostname;
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `[global-db] Refusing to run tests: ${name} host "${host}" is not a local test ` +
        `database. Only localhost / 127.0.0.1 / ::1 are permitted. This guard exists ` +
        `specifically to prevent tests from ever reaching a remote database.`
    );
  }

  if (/supabase|pooler/i.test(host)) {
    throw new Error(
      `[global-db] Refusing to run tests: ${name} host "${host}" looks like a remote ` +
        `Supabase database. Tests must never run against Supabase, under any circumstances.`
    );
  }

  const dbName = url.pathname.replace(/^\//, "");
  if (dbName !== REQUIRED_DB_NAME) {
    throw new Error(
      `[global-db] Refusing to run tests: ${name} database name is "${dbName}", expected ` +
        `"${REQUIRED_DB_NAME}". This guard exists to prevent tests from truncating the ` +
        `wrong database — including a developer's own local database.`
    );
  }
}

function resolveTestDatabaseUrls(): { databaseUrl: string; directUrl: string } {
  let databaseUrl = process.env.DATABASE_URL;
  let directUrl = process.env.DIRECT_URL;

  if (!databaseUrl || !directUrl) {
    let content: string;
    try {
      content = readFileSync(TEST_ENV_PATH, "utf8");
    } catch {
      throw new Error(
        `[global-db] Could not read ${TEST_ENV_PATH}. Database-backed tests require ` +
          `DATABASE_URL and DIRECT_URL, either already set in the environment (CI) or ` +
          `provided via .env.test (local). Run "npm run db:test:up" first.`
      );
    }
    const parsed = parseEnvFile(content);
    databaseUrl = databaseUrl || parsed.DATABASE_URL;
    directUrl = directUrl || parsed.DIRECT_URL;
  }

  if (!databaseUrl || !directUrl) {
    throw new Error(
      "[global-db] DATABASE_URL/DIRECT_URL could not be resolved from the environment " +
        "or .env.test. Refusing to run database-backed tests."
    );
  }

  assertSafeTestDatabaseUrl("DATABASE_URL", databaseUrl);
  assertSafeTestDatabaseUrl("DIRECT_URL", directUrl);

  return { databaseUrl, directUrl };
}

// FK-safe order is irrelevant here — a single TRUNCATE ... CASCADE handles
// dependency ordering in one statement. Table names are a hardcoded literal
// list (not user input), so building the SQL string directly is safe.
const APP_TABLES = [
  "audit_logs",
  "assessment_attempts",
  "assessment_candidates",
  "assessments",
  "organization_members",
  "organizations",
  "subscription_events",
  "subscriptions",
  "payment_events",
  "payments",
  "certificates",
  "user_key_stats",
  "practice_sessions",
  "test_results",
  "test_sessions",
  "passages",
  "users",
];

export default async function globalSetup(): Promise<void> {
  const { databaseUrl, directUrl } = resolveTestDatabaseUrls();

  // Write the validated URLs back into THIS process's env immediately.
  // globalSetup runs in Vitest's main process, and worker processes for
  // test files are spawned after globalSetup completes, inheriting this
  // process's env at that point. Without this assignment, the
  // `await import("@prisma/client")` below would trigger Prisma's own
  // .env auto-load (since DATABASE_URL would still be unset here),
  // silently overwriting process.env.DATABASE_URL with whatever is in the
  // real .env — which then leaks into every worker. Setting it here first
  // makes that auto-load a no-op (dotenv never overrides an already-set
  // variable) and guarantees workers inherit the validated test URL.
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = directUrl;

  // Passed explicitly so the migrate subprocess sees the validated test
  // URLs regardless of what .env on disk contains.
  const childEnv = { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: directUrl };

  execSync("npx prisma migrate deploy", {
    cwd: REPO_ROOT,
    env: childEnv,
    stdio: "inherit",
  });

  const { PrismaClient } = await import("@prisma/client");
  // Explicit datasource override — belt-and-suspenders on top of the env
  // var, so the truncate below can never silently target anything other
  // than the already-validated test database.
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const tableList = APP_TABLES.map((t) => `"${t}"`).join(", ");
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`
    );
  } finally {
    await prisma.$disconnect();
  }
}
