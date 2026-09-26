/**
 * Pure helpers for scripts/prisma-migration.ts — the migration workflow that
 * replaces `prisma migrate dev`.
 *
 * Why not `migrate dev`: its shadow database replays migrations without the
 * `_prisma_migrations` table, so migration
 * 20260926000000_lock_down_public_schema_data_api (which enables RLS on that
 * table) fails there with P3006/P1014. That migration is applied in production
 * and stays unchanged. Instead, the workflow replays the history with
 * `prisma migrate deploy` — which creates `_prisma_migrations` first, exactly as
 * in production — into a throwaway local database, and diffs that against
 * schema.prisma with `prisma migrate diff --from-url`.
 */

/** Hosts a scratch database may be created on. Never a remote server. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const REDIRECT_PARAMETERS = new Set(["host", "hostaddr", "service", "servicefile"]);

export const DEFAULT_SCRATCH_SERVER_URL =
  "postgresql://postgres:postgres@localhost:5434/postgres";

/** `prisma migrate diff --script` output when there is nothing to migrate. */
const EMPTY_MIGRATION = "-- This is an empty migration.";

/**
 * Parses the server URL a scratch database is created on, and refuses anything
 * that is not a local Postgres. Errors never include the URL (it may carry a
 * password).
 */
export function localServerUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MIGRATION_SCRATCH_SERVER_URL is not a valid URL");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("MIGRATION_SCRATCH_SERVER_URL must be a postgresql:// URL");
  }
  // Connection parameters that can point the connection at another server than
  // the URL's host (Prisma honours host=; libpq also hostaddr= and service=).
  // Matched case-insensitively, failing closed.
  for (const key of url.searchParams.keys()) {
    if (REDIRECT_PARAMETERS.has(key.toLowerCase())) {
      throw new Error(
        "MIGRATION_SCRATCH_SERVER_URL must not carry host/hostaddr/service parameters"
      );
    }
  }
  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(
      "MIGRATION_SCRATCH_SERVER_URL must be a local Postgres (localhost, 127.0.0.1 or ::1); " +
        "migrations are never generated or checked against a remote database"
    );
  }
  return url;
}

/** The same server, a different database. */
export function databaseUrl(server: URL, database: string): string {
  const url = new URL(server.toString());
  url.pathname = `/${database}`;
  return url.toString();
}

/** Safe to print: host, port and database only. */
export function describeUrl(raw: string): string {
  const url = new URL(raw);
  return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
}

/** A unique, identifier-safe name for a throwaway database. */
export function scratchDatabaseName(now: Date, random: string): string {
  if (!/^[a-z0-9]+$/.test(random)) throw new Error("random suffix must be [a-z0-9]+");
  return `prisma_migration_scratch_${timestamp(now)}_${random}`;
}

/** Prisma's migration timestamp: UTC YYYYMMDDHHMMSS. */
export function timestamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
  );
}

/** Directory name of a new migration, e.g. 20261001120000_add_badges. */
export function migrationDirectoryName(now: Date, name: string): string {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(name)) {
    throw new Error(
      `Migration name must be lowercase snake_case (letters, digits, underscores), got "${name}"`
    );
  }
  return `${timestamp(now)}_${name}`;
}

export function isEmptyMigration(sql: string): boolean {
  const trimmed = sql.trim();
  return trimmed === "" || trimmed === EMPTY_MIGRATION;
}

/** Tables a generated migration creates, from Prisma's `CREATE TABLE "name"` statements. */
export function createdTables(sql: string): string[] {
  const tables: string[] = [];
  for (const match of sql.matchAll(/^CREATE TABLE (?:"public"\.)?"([A-Za-z0-9_]+)"/gm)) {
    if (match[1] && !tables.includes(match[1])) tables.push(match[1]);
  }
  return tables;
}

/**
 * Appends ENABLE ROW LEVEL SECURITY for every table the migration creates:
 * application tables are server-only (ARCHITECTURE.md, Database Access Model),
 * and tests/integration/db-privileges-pg.test.ts fails for a table without it.
 */
export function withRowLevelSecurity(sql: string): string {
  const tables = createdTables(sql);
  if (tables.length === 0) return sql;
  const statements = tables
    .map((t) => `ALTER TABLE "public"."${t}" ENABLE ROW LEVEL SECURITY;`)
    .join("\n");
  return (
    `${sql.trimEnd()}\n\n` +
    `-- Server-only tables: deny Supabase's Data API roles (no policies).\n` +
    `${statements}\n`
  );
}
