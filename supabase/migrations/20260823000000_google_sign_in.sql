-- =============================================================================
-- Sign in with Google.
--
-- Three things, in the order the request flows:
--
--   1. Two rows in integration_secrets for the operator to paste the Google
--      OAuth client id and secret into from the admin console. The reconcile
--      script on the server copies them into GoTrue's environment.
--   2. A public app_settings row carrying the WEB client id alone. The Android
--      app has to hand that id to Google's Credential Manager before it can ask
--      for an id token, so it must be readable with the anon key. A client id
--      is public by design (it ships inside the APK); the secret never leaves
--      the server.
--   3. admin_link_identity(): attaches a verified Google identity to an existing
--      account. GoTrue's own link endpoint is a browser redirect, which Google
--      refuses inside a WebView, so the app sends the id token to the
--      link-google function instead, and that function calls this.
--
-- Apply with:  supabase db push  /  psql -f
-- Idempotent.
-- =============================================================================

INSERT INTO public.integration_secrets (key, label, description, is_secret) VALUES
  ('GOOGLE_CLIENT_ID',     'Google OAuth client ID (Web application)',
     'Looks like 1234567890-abc.apps.googleusercontent.com. The WEB client, not the Android one', false),
  ('GOOGLE_CLIENT_SECRET', 'Google OAuth client secret',
     'From the same Web application client in Google Cloud Console',                            true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value) VALUES
  ('auth', jsonb_build_object('google_web_client_id', ''))
ON CONFLICT (key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- admin_link_identity — attach an external identity to an existing user
--
-- SERVICE ROLE ONLY. This function trusts its arguments: it does not, and
-- cannot, check that the caller really owns the Google account named by
-- p_provider_id. That check is the link-google function's job - it sends the id
-- token to Google, confirms the signature, audience and verified email, and
-- only then calls this. Granting it to `authenticated` would let any signed-in
-- merchant bind ANY Google `sub` to their own account, after which whoever owns
-- that Google account signs in and lands inside the merchant's data.
--
-- Mirrors what GoTrue does when it links an identity itself: one row in
-- auth.identities, and the provider name appended to the user's
-- app_metadata.providers so the client sees the change.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_link_identity(
  p_user_id       UUID,
  p_provider      TEXT,
  p_provider_id   TEXT,
  p_identity_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing_user UUID;
  v_existing_id   UUID;
  v_other_sub     TEXT;
  v_identity_id   UUID;
  v_providers     JSONB;
BEGIN
  -- Google is the only provider the app links today. Anything else is a bug
  -- in a caller, not a feature request.
  IF p_provider IS DISTINCT FROM 'google' THEN
    RAISE EXCEPTION 'Unsupported provider %', p_provider;
  END IF;
  IF p_user_id IS NULL OR coalesce(p_provider_id, '') = '' THEN
    RAISE EXCEPTION 'A user id and a provider id are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'No such user';
  END IF;

  -- One Google account per CatalogShare account. Silently replacing a linked
  -- Google account would let a second person on a shared phone hijack the
  -- sign-in without the owner ever being told.
  SELECT provider_id INTO v_other_sub
    FROM auth.identities
   WHERE user_id = p_user_id AND provider = p_provider AND provider_id <> p_provider_id
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'This account already has a different Google account connected. Disconnect it first.';
  END IF;

  SELECT user_id, id INTO v_existing_user, v_existing_id
    FROM auth.identities
   WHERE provider = p_provider AND provider_id = p_provider_id;

  IF FOUND THEN
    IF v_existing_user <> p_user_id THEN
      RAISE EXCEPTION 'That Google account is already connected to another CatalogShare account.';
    END IF;

    -- Already linked to this very user: refresh the profile data and say so.
    UPDATE auth.identities
       SET identity_data   = p_identity_data,
           updated_at      = now(),
           last_sign_in_at = now()
     WHERE id = v_existing_id;

    RETURN jsonb_build_object('ok', true, 'already', true, 'identity_id', v_existing_id);
  END IF;

  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (p_provider_id, p_user_id, p_identity_data, p_provider, now(), now(), now())
  RETURNING id INTO v_identity_id;

  -- app_metadata.providers is what the client reads to know which sign-in
  -- methods an account has. GoTrue maintains it on its own link path; this
  -- path has to do the same by hand. `provider` (singular) is the one the
  -- account was created with and is left alone.
  SELECT coalesce(raw_app_meta_data, '{}'::jsonb) INTO v_providers FROM auth.users WHERE id = p_user_id;
  IF jsonb_typeof(v_providers -> 'providers') IS DISTINCT FROM 'array' THEN
    v_providers := jsonb_set(v_providers, '{providers}', '[]'::jsonb, true);
  END IF;
  IF NOT (v_providers -> 'providers') ? p_provider THEN
    v_providers := jsonb_set(v_providers, '{providers}', (v_providers -> 'providers') || to_jsonb(p_provider), true);
  END IF;

  UPDATE auth.users
     SET raw_app_meta_data = v_providers,
         updated_at        = now()
   WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'already', false, 'identity_id', v_identity_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_link_identity(UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_link_identity(UUID, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.admin_link_identity(UUID, TEXT, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_link_identity(UUID, TEXT, TEXT, JSONB) TO service_role;

-- link-google calls this RPC through PostgREST, which caches the schema on
-- start. Without a reload PostgREST answers PGRST202 ("function not found") for
-- admin_link_identity until it is restarted, so the very first Google link
-- after this migration would fail. This asks it to reload immediately.
NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'GOOGLE_CLIENT_ID row'       AS object, CASE WHEN EXISTS (SELECT 1 FROM public.integration_secrets WHERE key = 'GOOGLE_CLIENT_ID') THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'GOOGLE_CLIENT_SECRET row',   CASE WHEN EXISTS (SELECT 1 FROM public.integration_secrets WHERE key = 'GOOGLE_CLIENT_SECRET') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'app_settings.auth',          CASE WHEN EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'auth') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'admin_link_identity()',      CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_link_identity') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'admin_link_identity() not callable by authenticated',
  CASE WHEN has_function_privilege('authenticated', 'public.admin_link_identity(uuid, text, text, jsonb)', 'EXECUTE')
       THEN 'LEAKING' ELSE 'OK' END
UNION ALL SELECT 'admin_link_identity() callable by service_role',
  CASE WHEN has_function_privilege('service_role', 'public.admin_link_identity(uuid, text, text, jsonb)', 'EXECUTE')
       THEN 'OK' ELSE 'MISSING' END;
