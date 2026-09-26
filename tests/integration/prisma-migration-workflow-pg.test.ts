/**
 * The migration workflow (scripts/prisma-migration.ts) end to end, against the
 * local test Postgres only.
 *
 * Each run uses a temporary copy of scripts/ and prisma/ (node_modules is
 * symlinked), so the repository's schema and migrations are never modified.
 * The scratch server is the test database's own local server; the script
 * itself refuses anything else. DATABASE_URL / DIRECT_URL and a .env file
 * point at an unreachable fake remote to prove the workflow never uses them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { db } from "@/server/db";

const REPO_ROOT = resolve(__dirname, "../..");
const TIMEOUT = 180_000;

// Unreachable, and remote-looking: must never be used. Fake credentials only.
const FAKE_REMOTE_URL =
  "postgresql://postgres.fakeprojectref:fake-remote-pw-123@db.invalid.example:5432/postgres";

/** The local server behind the test database (already validated as local by the test setup). */
function scratchServerUrl(): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = "/postgres";
  url.search = "";
  return url.toString();
}

let root: string;

function freshCopy() {
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), "prisma-migration-workflow-"));
  cpSync(join(REPO_ROOT, "scripts"), join(root, "scripts"), { recursive: true });
  cpSync(join(REPO_ROOT, "prisma"), join(root, "prisma"), { recursive: true });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"), "dir");
  // A production-like .env must be ignored.
  writeFileSync(
    join(root, ".env"),
    `DATABASE_URL=${FAKE_REMOTE_URL}\nDIRECT_URL=${FAKE_REMOTE_URL}\n`
  );
}

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(
    join(root, "node_modules", ".bin", "tsx"),
    ["scripts/prisma-migration.ts", ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: FAKE_REMOTE_URL,
        DIRECT_URL: FAKE_REMOTE_URL,
        MIGRATION_SCRATCH_SERVER_URL: scratchServerUrl(),
        CHECKPOINT_DISABLE: "1",
        ...env,
      },
      encoding: "utf8",
      timeout: TIMEOUT,
    }
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

async function scratchDatabases(): Promise<string[]> {
  const rows = await db.$queryRaw<{ datname: string }[]>`
    SELECT datname FROM pg_database WHERE datname LIKE 'prisma_migration_scratch_%'`;
  return rows.map((r) => r.datname).sort();
}

const migrationDirs = () =>
  readdirSync(join(root, "prisma", "migrations"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

let before: string[];

beforeAll(async () => {
  before = await scratchDatabases();
});

afterAll(async () => {
  if (root) rmSync(root, { recursive: true, force: true });
  // Nothing may be left behind by any run.
  expect(await scratchDatabases()).toEqual(before);
});

describe("db:migrate:check", () => {
  it(
    "L: passes when schema.prisma matches the migration history, and drops its scratch database",
    async () => {
      freshCopy();
      const { status, output } = run(["check"]);
      expect(output).toContain(
        "The migration history applies cleanly and matches schema.prisma"
      );
      expect(status).toBe(0);
      expect(await scratchDatabases()).toEqual(before);
      // Never .env's or the environment's (fake remote) database.
      expect(output).not.toContain("db.invalid.example");
      expect(output).not.toContain("fake-remote-pw-123");
    },
    TIMEOUT
  );

  it(
    "K: fails when schema.prisma has a change no migration captures, and still drops its scratch database",
    async () => {
      freshCopy();
      appendFileSync(
        join(root, "prisma", "schema.prisma"),
        '\nmodel WorkflowProbe {\n  id String @id @default(uuid()) @db.Uuid\n\n  @@map("workflow_probes")\n}\n'
      );
      const { status, output } = run(["check"]);
      expect(status).toBe(1);
      expect(output).toContain("schema.prisma has changes that no migration captures");
      expect(output).toContain('CREATE TABLE "workflow_probes"');
      expect(await scratchDatabases()).toEqual(before);
    },
    TIMEOUT
  );
});

describe("db:migrate:new", () => {
  it(
    "writes nothing when there is nothing to migrate",
    async () => {
      freshCopy();
      const dirs = migrationDirs();
      const { status, output } = run(["new", "nothing_to_do"]);
      expect(status).toBe(0);
      expect(output).toContain("no migration written");
      expect(migrationDirs()).toEqual(dirs);
    },
    TIMEOUT
  );

  it(
    "J: writes a migration that enables RLS on each new table; it replays cleanly and check then passes",
    async () => {
      freshCopy();
      appendFileSync(
        join(root, "prisma", "schema.prisma"),
        '\nmodel WorkflowProbe {\n  id String @id @default(uuid()) @db.Uuid\n\n  @@map("workflow_probes")\n}\n'
      );
      const dirs = migrationDirs();

      const created = run(["new", "add_workflow_probes"]);
      expect(created.status).toBe(0);
      const added = migrationDirs().filter((d) => !dirs.includes(d));
      expect(added).toHaveLength(1);
      expect(added[0]).toMatch(/^\d{14}_add_workflow_probes$/);
      const sql = readFileSync(
        join(root, "prisma", "migrations", added[0]!, "migration.sql"),
        "utf8"
      );
      expect(sql).toContain('CREATE TABLE "workflow_probes"');
      expect(sql).toContain(
        'ALTER TABLE "public"."workflow_probes" ENABLE ROW LEVEL SECURITY;'
      );

      // The new migration is part of the history now: it applies with
      // migrate deploy and leaves nothing uncaptured.
      const checked = run(["check"]);
      expect(checked.output).toContain("matches schema.prisma");
      expect(checked.status).toBe(0);
      expect(await scratchDatabases()).toEqual(before);
    },
    TIMEOUT * 2
  );

  it("rejects a migration name that is not snake_case, before connecting anywhere", () => {
    freshCopy();
    const { status, output } = run(["new", "../escape"]);
    expect(status).toBe(1);
    expect(output).toContain("Migration name must be lowercase snake_case");
    expect(existsSync(join(root, "escape"))).toBe(false);
  });
});

describe("scratch server safety", () => {
  it.each([
    ["a remote host", FAKE_REMOTE_URL],
    ["a remote IP", "postgresql://u:fake-remote-pw-123@203.0.113.10:5432/postgres"],
    [
      "a host= redirect",
      "postgresql://u:fake-remote-pw-123@localhost:5432/postgres?host=db.invalid.example",
    ],
    [
      "a hostaddr= redirect",
      "postgresql://u:fake-remote-pw-123@127.0.0.1:5432/postgres?hostaddr=203.0.113.10",
    ],
    ["a malformed URL", "not a url fake-remote-pw-123"],
  ])("refuses %s before connecting, without echoing it", async (_label, url) => {
    freshCopy();
    const { status, output } = run(["check"], { MIGRATION_SCRATCH_SERVER_URL: url });
    expect(status).toBe(1);
    expect(output).toContain("MIGRATION_SCRATCH_SERVER_URL");
    expect(output).not.toContain("fake-remote-pw-123");
    expect(output).not.toContain("Replaying migrations");
    expect(await scratchDatabases()).toEqual(before);
  });
});
