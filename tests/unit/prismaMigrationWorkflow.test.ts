/**
 * The migration workflow that replaces `prisma migrate dev`
 * (scripts/prisma-migration.ts, scripts/lib/prismaMigration.ts), and the
 * immutability of migrations already applied in production.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createdTables,
  databaseUrl,
  DEFAULT_SCRATCH_SERVER_URL,
  describeUrl,
  isEmptyMigration,
  localServerUrl,
  migrationDirectoryName,
  scratchDatabaseName,
  timestamp,
  withRowLevelSecurity,
} from "../../scripts/lib/prismaMigration";

const MIGRATIONS_DIR = resolve(__dirname, "../../prisma/migrations");

/**
 * sha256 of every migration applied in production — what Prisma records as its
 * checksum. Editing an applied migration changes it, and `prisma migrate dev`
 * then demands a reset of any database that applied the original. New
 * migrations are appended here once they are deployed.
 */
const APPLIED_MIGRATIONS: [string, string][] = [
  [
    "20260916000000_init",
    "4fd6372445719f76d1d784f79eaa0f2f6f5cd53bdd4403fccc4fadc5dee9aff4",
  ],
  [
    "20260917000000_b2b_assessments",
    "9f9193b659dc8a829c938390fc56464c5ee847544666c9c699411cfda6b52f33",
  ],
  [
    "20260917141704_phase_13_indexes",
    "70ef38d4d23001dc884fea6fb251e17c5b4bbd6776dbc621266a22f044002bb5",
  ],
  [
    "20260917142257_phase_13_pagination_index",
    "d930f2fa894c5d10f30e30066e0c1bf96b09f26ba13af53991d64c3b7bb13db3",
  ],
  [
    "20260917142644_fix_leaderboard_index",
    "273d787140fa4ee0cb310f69e0063b95fe05b7b61762e1e385eca94252a02dbd",
  ],
  [
    "20260917143855_drop_old_index",
    "e78979a3b8a3e4abd4ce6d5b54790898f5354ee09d6e1a2c54cf367eb697b71c",
  ],
  [
    "20260923134611_add_scoring_source",
    "2c3e8539571cb5be02aacca0eda76897d2e7fd79e88776d83b21d63ff693833c",
  ],
  [
    "20260923152000_add_trace_hash",
    "3acdb592187471c9490cb7f1fe409a5c4882978f46f62639c1c28dd95fc82d1d",
  ],
  [
    "20260924090000_add_certificate_pending_fulfillment",
    "7b30398b3764a30b0bce8534ec386d40dfcfc8717a397e02d8db32d7a248623b",
  ],
  [
    "20260925000000_long_certificate_passages",
    "d22e456a59332695bea67a3e2936bb0a6c7a02a29bf872b6ccd1547c7a2482e5",
  ],
  [
    "20260926000000_lock_down_public_schema_data_api",
    "3d3c111e4cbd0bb9ca0b36aeb5fb13f4b805a608ba3c22f4d1861897eefca743",
  ],
  [
    "20260930000000_words_mode_passages",
    "562ce1dc579542aac7aaed811d069add4ab3304fe2824ccd96966394c5d32962",
  ],
];

describe("applied migrations are immutable", () => {
  it.each(APPLIED_MIGRATIONS)("%s is unchanged", (name, checksum) => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, name, "migration.sql"));
    expect(createHash("sha256").update(sql).digest("hex")).toBe(checksum);
  });

  it("keeps the applied history as the prefix of the migrations directory", () => {
    const directories = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directories.slice(0, APPLIED_MIGRATIONS.length)).toEqual(
      APPLIED_MIGRATIONS.map(([name]) => name)
    );
  });
});

describe("scratch server URL", () => {
  it.each([
    DEFAULT_SCRATCH_SERVER_URL,
    "postgresql://postgres:password@localhost:5432/postgres",
    "postgres://u:p@127.0.0.1:5434/postgres",
    "postgresql://u:p@[::1]:5432/postgres",
  ])("accepts a local Postgres: %s", (raw) => {
    expect(() => localServerUrl(raw)).not.toThrow();
  });

  it.each([
    [
      "a Supabase pooler",
      "postgresql://postgres.abcdefghijklmnopqrst:pw-SECRET@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
    ],
    ["a remote host", "postgresql://u:pw-SECRET@db.example.com:5432/postgres"],
    [
      "a host= override",
      "postgresql://u:pw-SECRET@localhost:5432/postgres?host=db.example.com",
    ],
    [
      "a hostaddr= override",
      "postgresql://u:pw-SECRET@localhost:5432/postgres?hostaddr=10.0.0.5",
    ],
    ["a remote IPv4 address", "postgresql://u:pw-SECRET@203.0.113.10:5432/postgres"],
    ["a private-network IPv4 address", "postgresql://u:pw-SECRET@10.0.0.5:5432/postgres"],
    ["a remote IPv6 address", "postgresql://u:pw-SECRET@[2001:db8::1]:5432/postgres"],
    ["a wildcard address", "postgresql://u:pw-SECRET@0.0.0.0:5432/postgres"],
    [
      "an upper-case HOST= override",
      "postgresql://u:pw-SECRET@localhost:5432/postgres?HOST=db.example.com",
    ],
    [
      "a URL-encoded host= override",
      "postgresql://u:pw-SECRET@localhost:5432/postgres?h%6Fst=db.example.com",
    ],
    [
      "a mixed-case hostAddr= override",
      "postgresql://u:pw-SECRET@127.0.0.1:5432/postgres?sslmode=disable&hostAddr=10.0.0.5",
    ],
    [
      "a service= override",
      "postgresql://u:pw-SECRET@localhost:5432/postgres?service=production",
    ],
    ["another protocol", "mysql://u:pw-SECRET@localhost:3306/db"],
    ["an empty value", ""],
    ["an invalid URL", "not a url pw-SECRET"],
  ])("refuses %s, without echoing the URL", (_label, raw) => {
    let message = "";
    try {
      localServerUrl(raw);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^MIGRATION_SCRATCH_SERVER_URL /);
    expect(message).not.toContain("pw-SECRET");
  });

  it("targets a scratch database on the same server and prints no credentials", () => {
    const server = localServerUrl(
      "postgresql://postgres:pw-SECRET@localhost:5434/postgres"
    );
    const scratch = databaseUrl(server, "prisma_migration_scratch_x");
    expect(new URL(scratch).pathname).toBe("/prisma_migration_scratch_x");
    expect(new URL(scratch).hostname).toBe("localhost");
    expect(describeUrl(scratch)).toBe("localhost:5434/prisma_migration_scratch_x");
    expect(describeUrl(scratch)).not.toContain("pw-SECRET");
  });
});

describe("names", () => {
  const now = new Date(Date.UTC(2026, 9, 1, 8, 5, 9));

  it("uses Prisma's UTC timestamp format", () => {
    expect(timestamp(now)).toBe("20261001080509");
    expect(migrationDirectoryName(now, "add_badges")).toBe("20261001080509_add_badges");
    expect(scratchDatabaseName(now, "a1b2c3d4")).toBe(
      "prisma_migration_scratch_20261001080509_a1b2c3d4"
    );
  });

  it.each(["", "Add Badges", "add-badges", "drop table;--", "_x", "x_"])(
    "rejects the migration name %j",
    (name) => {
      expect(() => migrationDirectoryName(now, name)).toThrow(/snake_case/);
    }
  );

  it("rejects a non-alphanumeric scratch suffix", () => {
    expect(() => scratchDatabaseName(now, "a;b")).toThrow();
  });
});

describe("generated SQL", () => {
  const createBadges = `-- CreateTable
CREATE TABLE "badges" (
    "id" UUID NOT NULL,
    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" UUID NOT NULL
);
`;

  it("recognises Prisma's empty migration", () => {
    expect(isEmptyMigration("-- This is an empty migration.\n")).toBe(true);
    expect(isEmptyMigration("   ")).toBe(true);
    expect(isEmptyMigration(createBadges)).toBe(false);
  });

  it("finds the tables a migration creates", () => {
    expect(createdTables(createBadges)).toEqual(["badges", "user_badges"]);
    expect(createdTables(`CREATE TABLE "public"."x" (id int);`)).toEqual(["x"]);
    expect(createdTables(`ALTER TABLE "users" ADD COLUMN "x" TEXT;`)).toEqual([]);
  });

  it("enables RLS on every new table (server-only, no policies)", () => {
    const sql = withRowLevelSecurity(createBadges);
    expect(sql.startsWith(createBadges.trimEnd())).toBe(true);
    expect(sql).toContain(`ALTER TABLE "public"."badges" ENABLE ROW LEVEL SECURITY;`);
    expect(sql).toContain(
      `ALTER TABLE "public"."user_badges" ENABLE ROW LEVEL SECURITY;`
    );
    expect(sql).not.toMatch(/CREATE POLICY|FORCE ROW LEVEL SECURITY/);
  });

  it("leaves a migration without new tables unchanged", () => {
    const alter = `ALTER TABLE "users" ADD COLUMN "x" TEXT;\n`;
    expect(withRowLevelSecurity(alter)).toBe(alter);
  });
});
