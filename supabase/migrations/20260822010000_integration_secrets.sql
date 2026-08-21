-- =============================================================================
-- Integration credentials, editable from the admin console.
--
-- SMTP, Razorpay and the rest currently live in env files on the server, which
-- means changing one is an SSH session. This table moves them into the console.
--
-- IT IS A SEPARATE TABLE FROM app_settings ON PURPOSE.
-- app_settings has a public SELECT policy - the client has to read the rewards
-- config to render the Earn screen. Putting an SMTP password or a Razorpay
-- secret in there would publish it to every visitor. This table has NO public
-- policy at all: admins only, and the server reads it with the service role.
--
-- Apply with:  supabase db push  /  psql -f
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.integration_secrets (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  -- Shown in the console so an operator knows what they are filling in without
  -- having to read this file.
  label       TEXT,
  description TEXT,
  -- Rendered as a password field and never echoed back to the browser once set.
  is_secret   BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;

-- Deliberately no anon/authenticated policy. Only admins, and only through the
-- console; the server reads this with the service role, which bypasses RLS.
DROP POLICY IF EXISTS "Admins manage integration secrets" ON public.integration_secrets;
CREATE POLICY "Admins manage integration secrets"
  ON public.integration_secrets FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.integration_secrets (key, label, description, is_secret) VALUES
  ('SMTP_HOST',           'SMTP host',            'smtp.resend.com for Resend, smtp.gmail.com for Gmail', false),
  ('SMTP_PORT',           'SMTP port',            '465 for SSL, 587 for STARTTLS',                        false),
  ('SMTP_USER',           'SMTP username',        'For Resend this is the literal word: resend',          false),
  ('SMTP_PASS',           'SMTP password',        'For Resend this is your API key',                      true),
  ('SMTP_FROM',           'Sender address',       'Must be on a domain you have verified with the provider', false),
  ('SMTP_FROM_NAME',      'Sender name',          'Shown as the sender in the inbox',                     false),
  ('RESEND_API_KEY',      'Resend API key',       'Used by the app''s own transactional emails',          true),
  ('RAZORPAY_KEY_ID',     'Razorpay key id',      'Starts with rzp_live_ or rzp_test_',                   false),
  ('RAZORPAY_KEY_SECRET', 'Razorpay key secret',  'From the Razorpay dashboard, API keys',                true),
  ('ADMOB_APP_ID',        'AdMob app id',         'ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX',               false),
  ('ADMOB_BANNER_ID',     'AdMob banner unit',    'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',               false),
  ('ADMOB_INTERSTITIAL_ID','AdMob interstitial unit','ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',            false),
  ('ADMOB_REWARDED_ID',   'AdMob rewarded unit',  'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX',               false),
  ('SUPPORT_EMAIL',       'Support email',        'Where merchant support mail is sent',                  false)
ON CONFLICT (key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- admin_set_integration_secret — write one value
--
-- Goes through a function rather than a direct UPDATE so that a blank submit
-- cannot silently wipe a working credential: the console renders a secret as
-- an empty password box (it never receives the stored value back), and a plain
-- table write would take that empty string at face value and break payments.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_integration_secret(p_key TEXT, p_value TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_secret BOOLEAN;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators may change integration settings';
  END IF;

  SELECT is_secret INTO v_is_secret FROM public.integration_secrets WHERE key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown integration setting %', p_key;
  END IF;

  -- Empty means "leave it alone" for a secret, and "clear it" for a plain
  -- value. Without this an operator who edits the SMTP host and saves the form
  -- takes the password down with it.
  IF v_is_secret AND (p_value IS NULL OR p_value = '') THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true);
  END IF;

  UPDATE public.integration_secrets
     SET value = COALESCE(p_value, ''), updated_at = now(), updated_by = auth.uid()
   WHERE key = p_key;

  RETURN jsonb_build_object('ok', true, 'unchanged', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_integration_secret(TEXT, TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- admin_list_integration_settings — read them WITHOUT leaking the secrets
--
-- Returns whether each secret is set, never what it is. A console that shows
-- the value has to send it to a browser, and a browser is a place credentials
-- end up in a screenshot.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_integration_settings()
RETURNS TABLE (key TEXT, label TEXT, description TEXT, is_secret BOOLEAN, value TEXT, is_set BOOLEAN, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators may read integration settings';
  END IF;

  RETURN QUERY
  SELECT s.key, s.label, s.description, s.is_secret,
         CASE WHEN s.is_secret THEN '' ELSE s.value END AS value,
         (s.value <> '') AS is_set,
         s.updated_at
    FROM public.integration_secrets s
   ORDER BY s.key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_integration_settings() TO authenticated;


-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'integration_secrets'              AS object, CASE WHEN to_regclass('public.integration_secrets') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'admin_set_integration_secret()',   CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_set_integration_secret') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'admin_list_integration_settings()',CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_list_integration_settings') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'no public read policy',            CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='integration_secrets' AND 'anon' = ANY(roles)
  ) THEN 'OK' ELSE 'LEAKING' END;
