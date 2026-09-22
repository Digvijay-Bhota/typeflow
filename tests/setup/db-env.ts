/**
 * Vitest setupFiles entry — runs before each test file's module graph is
 * loaded, in every worker.
 *
 * Why this exists: @prisma/client auto-loads .env at import time. If a
 * test file imports the real `db` (unmocked), that auto-load silently
 * injects whatever DATABASE_URL is in .env — which for this repo is a
 * remote Supabase database. This file wins that race by resolving and
 * validating the database URL *before* any test file (and therefore
 * before any Prisma import) runs.
 *
 * Resolution:
 *   1. If DATABASE_URL/DIRECT_URL are already set (CI sets them via the
 *      workflow step `env:` block) — preserve them, do not touch .env.test.
 *   2. Otherwise, load them from .env.test (local development / `npm test`).
 *   3. If they still cannot be resolved, fail immediately.
 *
 * Safety (applied unconditionally, regardless of source):
 *   - hostname must be localhost / 127.0.0.1 / [::1]
 *   - hostname must not look like a Supabase or pooler host
 *   - the URL must not carry a host= / hostaddr= query parameter
 *   - database name must be exactly "typeflow_test"
 *
 * There is no escape hatch. Any violation throws and aborts the run.
 * No credential values are ever logged — only hostname/db name, which are
 * not secrets.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEST_ENV_PATH = resolve(__dirname, "../../.env.test");
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

function loadFromTestEnvFileIfNeeded(): void {
  if (process.env.DATABASE_URL && process.env.DIRECT_URL) return;

  let content: string;
  try {
    content = readFileSync(TEST_ENV_PATH, "utf8");
  } catch {
    throw new Error(
      `[db-env] Could not read ${TEST_ENV_PATH}. Database-backed tests require ` +
        `DATABASE_URL and DIRECT_URL, either already set in the environment (CI) ` +
        `or provided via .env.test (local). Run "npm run db:test:up" first.`
    );
  }

  const parsed = parseEnvFile(content);
  if (!process.env.DATABASE_URL && parsed.DATABASE_URL) {
    process.env.DATABASE_URL = parsed.DATABASE_URL;
  }
  if (!process.env.DIRECT_URL && parsed.DIRECT_URL) {
    process.env.DIRECT_URL = parsed.DIRECT_URL;
  }
}

export function assertSafeTestDatabaseUrl(name: string, raw: string | undefined): void {
  if (!raw) {
    throw new Error(
      `[db-env] ${name} is not set. Run "npm run db:test:up" and re-run tests, ` +
        `or ensure CI provides ${name} directly. Refusing to run database-backed tests.`
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `[db-env] ${name} is not a valid connection URL. Refusing to run tests.`
    );
  }

  const host = url.hostname;
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(
      `[db-env] Refusing to run tests: ${name} host "${host}" is not a local test ` +
        `database. Only localhost / 127.0.0.1 / ::1 are permitted. This guard exists ` +
        `specifically to prevent tests from ever reaching a remote database.`
    );
  }

  if (/supabase|pooler/i.test(host)) {
    // Redundant with the allowlist above (a Supabase host would already have
    // failed it), but kept explicit and load-bearing on its own so this
    // guard doesn't silently depend on the allowlist never changing.
    throw new Error(
      `[db-env] Refusing to run tests: ${name} host "${host}" looks like a remote ` +
        `Supabase database. Tests must never run against Supabase, under any circumstances.`
    );
  }

  for (const key of url.searchParams.keys()) {
    if (FORBIDDEN_QUERY_PARAMS.has(key.trim().toLowerCase())) {
      throw new Error(
        `[db-env] Refusing to run tests: ${name} contains a "${key}" query parameter. ` +
          `host/hostaddr override the connection target that the hostname check above ` +
          `validates, so they are forbidden in test database URLs.`
      );
    }
  }

  const dbName = url.pathname.replace(/^\//, "");
  if (dbName !== REQUIRED_DB_NAME) {
    throw new Error(
      `[db-env] Refusing to run tests: ${name} database name is "${dbName}", expected ` +
        `"${REQUIRED_DB_NAME}". This guard exists to prevent tests from truncating the ` +
        `wrong database — including a developer's own local database.`
    );
  }
}

loadFromTestEnvFileIfNeeded();
assertSafeTestDatabaseUrl("DATABASE_URL", process.env.DATABASE_URL);
assertSafeTestDatabaseUrl("DIRECT_URL", process.env.DIRECT_URL);
