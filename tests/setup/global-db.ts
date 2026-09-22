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
 *   3. Discover the application tables from information_schema and truncate
 *      them so every test run starts clean, regardless of whether the
 *      previous run's cleanup hooks succeeded.
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

// WHATWG URL returns IPv6 hosts in bracketed form, so the loopback literal
// here is "[::1]" — a bare "::1" would never match url.hostname and would be
// dead code. Exact-match only: arbitrary IPv6 addresses stay rejected.
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// libpq (and therefore Prisma) honours these query parameters as the real
// connection target, overriding the host in the URL authority. Left
// unchecked, `postgresql://u:p@localhost:5434/typeflow_test?host=<remote>`
// would pass the hostname allowlist above while actually connecting
// elsewhere. Verified behaviour, not theoretical — so they are forbidden
// outright in test connection strings.
const FORBIDDEN_QUERY_PARAMS = new Set(["host", "hostaddr"]);

// Prisma's migration bookkeeping table must survive truncation, otherwise
// `migrate deploy` would re-apply every migration on the next run.
const MIGRATIONS_TABLE = "_prisma_migrations";

// Postgres identifiers we are willing to interpolate into a TRUNCATE. Any
// discovered table name that does not match is treated as hostile and
// aborts the run rather than being quoted-and-hoped-for.
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

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

export function assertSafeTestDatabaseUrl(name: string, raw: string): void {
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

  for (const key of url.searchParams.keys()) {
    if (FORBIDDEN_QUERY_PARAMS.has(key.trim().toLowerCase())) {
      throw new Error(
        `[global-db] Refusing to run tests: ${name} contains a "${key}" query parameter. ` +
          `host/hostaddr override the connection target that the hostname check above ` +
          `validates, so they are forbidden in test database URLs.`
      );
    }
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

/**
 * Discover the application tables to truncate, rather than maintaining a
 * hardcoded list that silently goes stale the first time someone adds a
 * Prisma model.
 *
 * Scope is pinned to BASE TABLEs in the `public` schema, so PostgreSQL
 * catalogs/system schemas are never in range, and `_prisma_migrations` is
 * excluded so `migrate deploy` does not re-apply everything next run.
 * Results are ordered for determinism.
 *
 * Every discovered name is validated against a strict identifier pattern
 * before it is interpolated — anything unexpected aborts the run instead
 * of being quoted and executed.
 */
export async function discoverApplicationTables(prisma: {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
}): Promise<string[]> {
  const rows = (await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> ${MIGRATIONS_TABLE}
    ORDER BY table_name
  `) as Array<{ table_name: string }>;

  const tables = rows.map((r) => r.table_name);

  const unsafe = tables.filter((t) => !SAFE_IDENTIFIER.test(t));
  if (unsafe.length > 0) {
    throw new Error(
      `[global-db] Refusing to truncate: discovered table name(s) that are not plain ` +
        `identifiers: ${unsafe.map((t) => JSON.stringify(t)).join(", ")}.`
    );
  }

  if (tables.length === 0) {
    throw new Error(
      "[global-db] Refusing to continue: no application tables were discovered in the " +
        "public schema of the test database. Expected `prisma migrate deploy` to have " +
        "created them — the test database may be pointing somewhere unexpected."
    );
  }

  return tables;
}

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
    const tables = await discoverApplicationTables(prisma);
    // FK-safe order is irrelevant — a single TRUNCATE ... CASCADE resolves
    // dependency ordering in one statement.
    const tableList = tables.map((t) => `"public"."${t}"`).join(", ");
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`
    );
  } finally {
    await prisma.$disconnect();
  }
}
