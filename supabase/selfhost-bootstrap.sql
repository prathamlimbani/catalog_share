-- =============================================================================
-- Self-hosted backend bootstrap: the roles, schemas and helper functions that
-- Supabase provides implicitly and that this app's 26 migrations assume exist.
--
-- Runs against a FRESH `catalogshare` database, before GoTrue and PostgREST
-- start. Idempotent.
--
-- The app's RLS policies are written entirely in terms of auth.uid(), so
-- reproducing that function exactly is what makes every existing policy work
-- unchanged against a self-hosted stack. Get it wrong and RLS silently opens or
-- silently closes - both catastrophic, neither loud.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

-- ---------------------------------------------------------------------------
-- Roles
--
-- PostgREST connects as `authenticator`, which can do nothing itself, and
-- SET ROLEs to anon / authenticated / service_role based on the JWT. That
-- indirection is the whole security model: a leaked connection string is a role
-- with no privileges until a signed token says otherwise.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- auth.uid() / auth.role() / auth.jwt()
--
-- PostgREST puts the verified JWT claims into the `request.jwt.claims` GUC.
-- These read it back. `current_setting(..., true)` returns NULL rather than
-- raising when the GUC is unset, which is what makes an anonymous request
-- evaluate policies as "no user" instead of erroring.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')
  )::JSONB;
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'sub')
  )::UUID;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'role')
  )::TEXT;
$$;

CREATE OR REPLACE FUNCTION auth.email()
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.email', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'email')
  )::TEXT;
$$;

-- ---------------------------------------------------------------------------
-- update_updated_at_column()
--
-- Referenced by triggers in several migrations. Supabase projects normally
-- already have it from an earlier hand-run statement, so no migration in this
-- repo actually creates it - which means a fresh database needs it here or
-- those migrations fail.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
--
-- PostgREST needs USAGE on the schema to see anything at all. Table privileges
-- are granted after the app migrations run (see grants.sql) because the tables
-- do not exist yet at this point.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public     TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth       TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION auth.uid()   TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role()  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt()   TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.email() TO anon, authenticated, service_role;

-- New tables created later by the migrations inherit these, so the grants file
-- afterwards is a backstop rather than the only thing standing between
-- PostgREST and a permission-denied on every request.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

SELECT 'bootstrap complete' AS status;
