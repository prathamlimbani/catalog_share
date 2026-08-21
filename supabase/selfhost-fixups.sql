-- =============================================================================
-- The four things Supabase provided implicitly that a fresh database does not.
--
-- Each of these was a real migration failure, not a precaution.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. storage schema
--
-- 20260210041253 inserts the `product-images` bucket and writes policies on
-- storage.objects. Shaped to match Supabase's own storage schema so the
-- storage-api container can take it over and run its own migrations against it.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  owner              UUID,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  public             BOOLEAN DEFAULT false,
  avif_autodetection BOOLEAN DEFAULT false,
  file_size_limit    BIGINT,
  allowed_mime_types TEXT[]
);
CREATE UNIQUE INDEX IF NOT EXISTS bname ON storage.buckets (name);

CREATE TABLE IF NOT EXISTS storage.objects (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id        TEXT REFERENCES storage.buckets(id),
  name             TEXT,
  owner            UUID,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  last_accessed_at TIMESTAMPTZ DEFAULT now(),
  metadata         JSONB,
  path_tokens      TEXT[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  version          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS bucketid_objname ON storage.objects (bucket_id, name);
CREATE INDEX IF NOT EXISTS name_prefix_search ON storage.objects (name text_pattern_ops);

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. supabase_realtime publication
--
-- Several migrations ALTER PUBLICATION to add a table. Realtime is not running
-- yet, but the publication has to exist for those statements to succeed - and
-- creating it now means the tables are already enrolled if realtime is added
-- later.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. password_reset_otps
--
-- LEGACY. Nothing in src/ or supabase/functions/ reads or writes this table -
-- password reset goes through the auth API - but a migration enables RLS on it
-- and fails if it is absent. Recreated so the migration history applies
-- cleanly; it can be dropped once that migration is squashed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.password_reset_otps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  otp        TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_otps_email_idx ON public.password_reset_otps (email);

-- ---------------------------------------------------------------------------
-- 4. companies.user_id -> owner_id
--
-- 20260304000001 writes an analytics policy against `companies.user_id`. That
-- column does not exist and never did in this schema; the owner column is
-- `owner_id`. The migration therefore FAILED on the real database too, which
-- means company owners have never been able to read their own analytics - only
-- master admins could. Applying the corrected policy here fixes that as a side
-- effect of the migration.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Company owners can view their analytics events" ON public.analytics_events;
CREATE POLICY "Company owners can view their analytics events"
  ON public.analytics_events FOR SELECT
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

SELECT 'fixups applied' AS status;
