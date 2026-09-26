/**
 * Application tables are server-only (migration
 * 20260926000000_lock_down_public_schema_data_api): Supabase's Data API roles
 * (anon, authenticated) can neither read nor write them, now or for tables
 * added later, while Prisma's role (postgres, the owner) is unaffected.
 *
 * Runs against the disposable test database, where tests/setup/supabase-roles.sql
 * recreates the Data API roles with Supabase's grants before migrating, so the
 * migration has to remove real privileges. Every probe runs in a transaction
 * that is rolled back: nothing is left behind and nothing is committed.
 *
 * PostgREST serves each request as `SET ROLE anon` / `SET ROLE authenticated`;
 * the probes do the same.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";

const DATA_API_ROLES = ["anon", "authenticated"] as const;
type DataApiRole = (typeof DATA_API_ROLES)[number];

/** The tables the migration covers: every table in "public" when it was written. */
const APPLICATION_TABLES = [
  "_prisma_migrations",
  "assessment_attempts",
  "assessment_candidates",
  "assessments",
  "audit_logs",
  "certificates",
  "organization_members",
  "organizations",
  "passages",
  "payment_events",
  "payments",
  "practice_sessions",
  "subscription_events",
  "subscriptions",
  "test_results",
  "test_sessions",
  "user_key_stats",
  "users",
];

/** Thrown to roll back a probe transaction that would otherwise commit. */
class Rollback extends Error {}

/** PostgreSQL SQLSTATE of a failed raw query. */
function sqlState(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const code = (error.meta as { code?: unknown } | undefined)?.code;
    if (typeof code === "string") return code;
  }
  return /\b(?:Code|code): `?(\w{5})`?/.exec(String(error))?.[1];
}

/**
 * Runs `statement` as `role` (after optional setup as the table owner) in a
 * transaction that always rolls back. Resolves to the error, or null.
 */
async function attemptAs(
  role: DataApiRole,
  statement: string,
  setupAsOwner: string[] = []
): Promise<unknown> {
  try {
    await db.$transaction(async (tx) => {
      for (const sql of setupAsOwner) await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
      await tx.$executeRawUnsafe(statement);
      throw new Rollback();
    });
  } catch (error) {
    return error instanceof Rollback ? null : error;
  }
  return null;
}

async function expectPermissionDenied(role: DataApiRole, statement: string) {
  const error = await attemptAs(role, statement);
  expect(error, `${role} must be denied: ${statement}`).not.toBeNull();
  expect(sqlState(error), String(error)).toBe("42501");
}

async function publicTables(): Promise<string[]> {
  const rows = await db.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`;
  return rows.map((r) => r.table_name);
}

describe("test database mirrors Supabase's Data API roles", () => {
  it("has anon, authenticated and service_role as NOLOGIN roles", async () => {
    const rows = await db.$queryRaw<{ rolname: string; rolcanlogin: boolean }[]>`
      SELECT rolname, rolcanlogin FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role')
      ORDER BY rolname`;
    // Without these roles every assertion below would pass vacuously.
    expect(rows).toEqual([
      { rolname: "anon", rolcanlogin: false },
      { rolname: "authenticated", rolcanlogin: false },
      { rolname: "service_role", rolcanlogin: false },
    ]);
  });
});

describe("Row Level Security", () => {
  it("is enabled on every table in public, and not forced", async () => {
    const rows = await db.$queryRaw<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`;

    expect(rows.map((r) => r.relname)).toEqual(
      expect.arrayContaining(APPLICATION_TABLES)
    );
    // Includes tables added after the migration: each needs its own
    // ENABLE ROW LEVEL SECURITY.
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
    expect(rows.filter((r) => r.relforcerowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("has no policies in public (deny-all for non-owner roles)", async () => {
    const rows = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'public'`;
    expect(Number(rows[0]?.n)).toBe(0);
  });
});

describe("Data API role privileges", () => {
  it.each(DATA_API_ROLES)("%s has no privileges on any table in public", async (role) => {
    const tableGrants = await db.$queryRaw<
      { table_name: string; privilege_type: string }[]
    >`
      SELECT table_name, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee = ${role}`;
    expect(tableGrants).toEqual([]);

    for (const table of await publicTables()) {
      const rows = await db.$queryRaw<{ any_privilege: boolean }[]>`
        SELECT has_table_privilege(${role}, ${`public.${table}`},
          'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') AS any_privilege`;
      expect(rows[0]?.any_privilege, `${role} on ${table}`).toBe(false);
    }
  });

  it.each(DATA_API_ROLES)(
    "%s has no column, sequence or function grants in public",
    async (role) => {
      const columns = await db.$queryRaw<unknown[]>`
        SELECT 1 FROM information_schema.column_privileges
        WHERE table_schema = 'public' AND grantee = ${role}`;
      const usage = await db.$queryRaw<unknown[]>`
        SELECT 1 FROM information_schema.usage_privileges
        WHERE object_schema = 'public' AND grantee = ${role}`;
      const routines = await db.$queryRaw<unknown[]>`
        SELECT 1 FROM information_schema.role_routine_grants
        WHERE routine_schema = 'public' AND grantee = ${role}`;
      expect({ columns, usage, routines }).toEqual({
        columns: [],
        usage: [],
        routines: [],
      });
    }
  );

  it("postgres' default privileges no longer grant anon/authenticated anything", async () => {
    const rows = await db.$queryRaw<{ objtype: string; acl: string }[]>`
      SELECT d.defaclobjtype AS objtype, d.defaclacl::text AS acl
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE n.nspname = 'public' AND d.defaclrole = 'postgres'::regrole`;
    for (const { objtype, acl } of rows) {
      expect(acl, `default ACL (${objtype})`).not.toMatch(
        /(^|[{,])(anon|authenticated)=/
      );
    }
  });

  it("a table created later is not exposed to anon/authenticated", async () => {
    const probe = `phase5c_probe_${randomUUID().replace(/-/g, "")}`;
    let privileges: { role: string; granted: boolean }[] = [];
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`CREATE TABLE public.${probe} (id int)`);
        privileges = await tx.$queryRawUnsafe(
          `SELECT r AS role, has_table_privilege(r, 'public.${probe}',
             'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') AS granted
           FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
           ORDER BY r`
        );
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    // service_role still gets Supabase's default grant, so the default
    // privileges are in effect and only anon/authenticated were removed.
    expect(privileges).toEqual([
      { role: "anon", granted: false },
      { role: "authenticated", granted: false },
      { role: "service_role", granted: true },
    ]);
  });
});

describe("Data API roles are denied (SQLSTATE 42501)", () => {
  it("anon cannot SELECT from users", async () => {
    await expectPermissionDenied("anon", `SELECT id FROM public.users LIMIT 1`);
  });

  it("anon cannot INSERT into certificates", async () => {
    await expectPermissionDenied(
      "anon",
      `INSERT INTO public.certificates ("id", "certificateId", "verificationHash", "userId",
         "resultId", "status", "testType", "language", "duration", "wpm", "rawWpm",
         "accuracy", "updatedAt")
       VALUES (gen_random_uuid(), 'TF-2026-FORGED', 'x', gen_random_uuid(), gen_random_uuid(),
         'ACTIVE', 'x', 'ENGLISH', 300, 100, 100, 1, now())`
    );
  });

  it("authenticated cannot UPDATE payments", async () => {
    await expectPermissionDenied(
      "authenticated",
      `UPDATE public.payments SET "status" = 'COMPLETED'`
    );
  });

  it("authenticated cannot DELETE from audit_logs", async () => {
    await expectPermissionDenied("authenticated", `DELETE FROM public.audit_logs`);
  });

  it("anon cannot TRUNCATE test_results", async () => {
    await expectPermissionDenied("anon", `TRUNCATE public.test_results`);
  });

  it.each(DATA_API_ROLES)(
    "%s cannot read or write the Prisma migration history",
    async (role) => {
      await expectPermissionDenied(role, `SELECT 1 FROM public._prisma_migrations`);
      await expectPermissionDenied(role, `DELETE FROM public._prisma_migrations`);
    }
  );
});

describe("each layer holds on its own", () => {
  // practice_sessions: no application code or other test touches it, so the
  // brief table locks taken inside these rolled-back transactions contend
  // with nothing.
  const seedRow = [
    `INSERT INTO public.users ("id", "authId", "email", "updatedAt")
     VALUES ('00000000-0000-4000-8000-00000000c501', gen_random_uuid(),
             'rls-layer-probe@example.com', now())`,
    `INSERT INTO public.practice_sessions ("id", "userId", "mode", "exerciseType", "durationMs")
     VALUES (gen_random_uuid(), '00000000-0000-4000-8000-00000000c501', 'probe', 'probe', 1)`,
  ];

  it("RLS alone hides every row if a SELECT grant were ever restored", async () => {
    let visible: number | undefined;
    try {
      await db.$transaction(async (tx) => {
        for (const sql of seedRow) await tx.$executeRawUnsafe(sql);
        await tx.$executeRawUnsafe(`GRANT SELECT ON public.practice_sessions TO anon`);
        await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
        const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM public.practice_sessions`
        );
        visible = Number(rows[0]?.n);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(visible).toBe(0);
  });

  it("the revoked grants alone deny access if RLS were ever disabled", async () => {
    const error = await attemptAs("anon", `SELECT 1 FROM public.practice_sessions`, [
      ...seedRow,
      `ALTER TABLE public.practice_sessions DISABLE ROW LEVEL SECURITY`,
    ]);
    expect(sqlState(error), String(error)).toBe("42501");
  });
});

describe("the application role is unaffected", () => {
  it("postgres (Prisma) can still create, read, update and delete", async () => {
    const email = `rls-owner-${randomUUID()}@example.com`;
    const user = await db.user.create({ data: { authId: randomUUID(), email } });
    try {
      expect(await db.user.findUnique({ where: { email } })).not.toBeNull();
      await db.user.update({ where: { id: user.id }, data: { displayName: "Owner" } });
      const rows = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM public.users WHERE id = ${user.id}::uuid`;
      expect(Number(rows[0]?.n)).toBe(1);
    } finally {
      await db.user.delete({ where: { id: user.id } });
    }
  });

  it("service_role and schema usage keep Supabase's grants", async () => {
    const rows = await db.$queryRaw<{ service_role: boolean; anon_usage: boolean }[]>`
      SELECT
        has_table_privilege('service_role', 'public.users',
          'SELECT, INSERT, UPDATE, DELETE') AS service_role,
        has_schema_privilege('anon', 'public', 'USAGE') AS anon_usage`;
    expect(rows[0]).toEqual({ service_role: true, anon_usage: true });
  });
});
