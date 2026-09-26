/**
 * Migration workflow that replaces `prisma migrate dev` (see
 * scripts/lib/prismaMigration.ts for why).
 *
 *   npm run db:migrate:new -- <name>   write a migration for schema.prisma changes
 *   npm run db:migrate:check           fail if schema.prisma has changes no migration captures
 *
 * Both replay every committed migration with `prisma migrate deploy` into a
 * throwaway database on a LOCAL Postgres (MIGRATION_SCRATCH_SERVER_URL, default
 * the docker-compose container), diff it against prisma/schema.prisma, and drop
 * it again. They never read .env's database URLs and never touch a remote
 * database. Apply a new migration to your local development database with
 * `prisma migrate deploy`.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_SCRATCH_SERVER_URL,
  databaseUrl,
  describeUrl,
  isEmptyMigration,
  localServerUrl,
  migrationDirectoryName,
  scratchDatabaseName,
  withRowLevelSecurity,
} from "./lib/prismaMigration";

const REPO_ROOT = resolve(__dirname, "..");
const SCHEMA = "prisma/schema.prisma";

function prisma(args: string[], options: { url: string; input?: string }) {
  const result = spawnSync("npx", ["prisma", ...args], {
    cwd: REPO_ROOT,
    // Both URLs point at the scratch database, so nothing falls back to .env.
    env: { ...process.env, DATABASE_URL: options.url, DIRECT_URL: options.url },
    input: options.input,
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** A failure to report; thrown (never process.exit) so the scratch database is always dropped. */
class WorkflowError extends Error {
  constructor(
    message: string,
    readonly detail = ""
  ) {
    super(message);
  }
}

function fail(message: string, detail = ""): never {
  throw new WorkflowError(message, detail);
}

/** Replays the migration history into a scratch database and returns the diff to schema.prisma. */
function diffAgainstReplayedHistory(): { sql: string; exitCode: number } {
  const server = localServerUrl(
    process.env.MIGRATION_SCRATCH_SERVER_URL || DEFAULT_SCRATCH_SERVER_URL
  );
  const serverUrl = server.toString();
  const scratch = scratchDatabaseName(new Date(), randomBytes(4).toString("hex"));
  const scratchUrl = databaseUrl(server, scratch);

  const create = prisma(["db", "execute", "--url", serverUrl, "--stdin"], {
    url: serverUrl,
    input: `CREATE DATABASE "${scratch}";`,
  });
  if (create.status !== 0) {
    fail(
      `Could not create a scratch database on ${describeUrl(serverUrl)}`,
      create.stderr
    );
  }
  try {
    console.error(
      `→ Replaying migrations into ${describeUrl(scratchUrl)} with migrate deploy`
    );
    const deploy = prisma(["migrate", "deploy", "--schema", SCHEMA], { url: scratchUrl });
    if (deploy.status !== 0)
      fail("The migration history does not apply cleanly", deploy.stdout + deploy.stderr);

    const diff = prisma(
      [
        "migrate",
        "diff",
        "--from-url",
        scratchUrl,
        "--to-schema-datamodel",
        SCHEMA,
        "--script",
        "--exit-code",
      ],
      { url: scratchUrl }
    );
    if (diff.status !== 0 && diff.status !== 2)
      fail("prisma migrate diff failed", diff.stderr);
    return { sql: diff.stdout, exitCode: diff.status };
  } finally {
    const drop = prisma(["db", "execute", "--url", serverUrl, "--stdin"], {
      url: serverUrl,
      input: `DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE);`,
    });
    if (drop.status !== 0) {
      console.error(
        `⚠ Could not drop the scratch database ${scratch} on ${describeUrl(serverUrl)}; drop it manually.`
      );
    }
  }
}

function newMigration(name: string | undefined) {
  if (!name) fail("Usage: npm run db:migrate:new -- <snake_case_name>");
  const directory = migrationDirectoryName(new Date(), name);
  const { sql } = diffAgainstReplayedHistory();
  if (isEmptyMigration(sql)) {
    console.error("✓ schema.prisma matches the migration history; no migration written.");
    return;
  }
  const path = resolve(REPO_ROOT, "prisma/migrations", directory, "migration.sql");
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, withRowLevelSecurity(sql));
  console.error(
    `✓ Wrote prisma/migrations/${directory}/migration.sql — review it, then apply it to your ` +
      `local database with prisma migrate deploy.`
  );
}

function check() {
  const { sql, exitCode } = diffAgainstReplayedHistory();
  if (exitCode === 2 && !isEmptyMigration(sql)) {
    fail(
      "schema.prisma has changes that no migration captures. Run npm run db:migrate:new -- <name>.",
      sql
    );
  }
  console.error("✓ The migration history applies cleanly and matches schema.prisma.");
}

const [command, name] = process.argv.slice(2);
try {
  if (command === "new") newMigration(name);
  else if (command === "check") check();
  else fail("Usage: tsx scripts/prisma-migration.ts <new <name> | check>");
} catch (error) {
  const detail = error instanceof WorkflowError ? error.detail.trim() : "";
  console.error(`✖ ${(error as Error).message}${detail ? `\n${detail}` : ""}`);
  process.exit(1);
}
