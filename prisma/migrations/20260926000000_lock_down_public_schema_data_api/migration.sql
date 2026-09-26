-- Application tables are server-only: the app reads and writes them through
-- Prisma (the table owner), never through Supabase's Data API. Supabase grants
-- its Data API roles (anon, authenticated) full privileges on every table in
-- "public" — the anon key ships to every browser — so this migration locks
-- those roles out, now and for objects created later:
--
--   1. RLS on every table, with no policies: deny-all for any role that is not
--      the owner and does not have BYPASSRLS.
--   2. Revoke anon/authenticated privileges on existing tables, sequences and
--      functions (RLS does not cover TRUNCATE), and on future ones through the
--      default privileges.
--
-- Unaffected: the owner/migration role (postgres), service_role, schema USAGE,
-- and the auth and storage schemas. No FORCE ROW LEVEL SECURITY.
--
-- Every statement is idempotent. Prisma applies this file in one transaction.
-- Every table added later needs its own ENABLE ROW LEVEL SECURITY
-- (tests/integration/db-privileges-pg.test.ts fails otherwise).

-- Fail fast rather than queue live traffic behind the ALTER TABLE locks.
SET LOCAL lock_timeout = '5s';

-- 1. Row Level Security, deny-all (no policies).
ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."passages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."test_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."test_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."practice_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_key_stats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."subscription_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."assessment_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."assessment_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;

-- 2. Privileges. The Data API roles exist only on Supabase; a plain Postgres
-- (local tests, CI) without them skips this block.
DO $$
DECLARE
  api_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) THEN
    RETURN;
  END IF;

  -- Supabase's default privileges belong to the role that creates the tables.
  -- Revoking them requires being that role (or a member of it); fail loudly
  -- rather than leave future tables exposed.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
     OR NOT pg_has_role(current_user, 'postgres', 'MEMBER') THEN
    RAISE EXCEPTION
      'This migration must run as postgres (or a member of it); current_user is %',
      current_user;
  END IF;

  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END $$;
