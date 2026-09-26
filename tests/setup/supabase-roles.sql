-- TEST DATABASE ONLY. Reproduces Supabase's Data API roles and the grants
-- Supabase gives them, so the lock-down migration
-- (prisma/migrations/20260926000000_lock_down_public_schema_data_api) runs
-- against the state it has to fix instead of passing vacuously on a plain
-- Postgres that has no such roles.
--
-- Run before `prisma migrate deploy` by tests/setup/global-db.ts (after its
-- URL guards), by the CI migrate step and by `npm run db:test:migrate`.
-- Idempotent. Refuses to run anywhere but the disposable typeflow_test
-- database, and never on a Supabase database.
DO $$
BEGIN
  IF current_database() <> 'typeflow_test' THEN
    RAISE EXCEPTION 'supabase-roles.sql only runs on the typeflow_test database, not %',
      current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('supabase_admin', 'authenticator')) THEN
    RAISE EXCEPTION 'supabase-roles.sql refuses to run on a Supabase database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    RAISE EXCEPTION 'The test database needs a postgres role (see docker-compose.yml)';
  END IF;

  -- The Data API roles, as on Supabase: no login, service_role bypasses RLS.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;

  -- Once the lock-down migration is applied, leave its result alone.
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public._prisma_migrations
      WHERE migration_name = '20260926000000_lock_down_public_schema_data_api'
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
    ) THEN
      RETURN;
    END IF;
  END IF;

  -- Supabase's starting grants: schema usage, every existing object, and every
  -- object postgres creates later (default privileges).
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
  GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
END $$;
