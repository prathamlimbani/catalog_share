-- =============================================================================
-- WhatsApp OTP verification, switchable SMTP, and admin-controlled auth gates.
--
-- Three things move here:
--
--  1. EMAIL STOPS BEING THE ONLY CHANNEL. `email_providers` holds one row per
--     SMTP account (Resend, Microsoft 365, Gmail, anything) and exactly one is
--     active. Both the functions host and GoTrue read the active one, so
--     switching provider is a click rather than an SSH session.
--
--  2. WHATSAPP BECOMES THE PERMANENT CHANNEL, via Fast2SMS. `whatsapp_templates`
--     maps a purpose ("otp", later "payment_reminder", "payment_received") to
--     the Fast2SMS message_id for an approved template, so a new template is a
--     row insert and not a release.
--
--  3. WHAT IS VERIFIED BECOMES A SETTING. `app_settings.auth` gains switches for
--     email verification, WhatsApp verification and login 2FA. They are in
--     app_settings (public read) on purpose: the app has to know which steps to
--     render before anyone is signed in. Nothing secret is stored there.
--
-- Apply with:  supabase db push  /  psql -f
-- Idempotent.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. email_providers — one row per SMTP account, one of them active
--
-- NO PUBLIC POLICY, exactly like integration_secrets and for the same reason:
-- this table holds SMTP passwords. app_settings is publicly readable and would
-- have published them to every visitor.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_providers (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  host        TEXT NOT NULL DEFAULT '',
  port        INTEGER NOT NULL DEFAULT 587,
  -- true = implicit TLS on connect (port 465). false = STARTTLS (587).
  secure      BOOLEAN NOT NULL DEFAULT false,
  username    TEXT NOT NULL DEFAULT '',
  password    TEXT NOT NULL DEFAULT '',
  from_email  TEXT NOT NULL DEFAULT '',
  from_name   TEXT NOT NULL DEFAULT 'CatalogShare',
  reply_to    TEXT NOT NULL DEFAULT '',
  -- 'smtp' for everything, or 'resend_api' to use the Resend HTTPS API instead
  -- of SMTP. The API path needs no SMTP port open outbound, which is the one
  -- thing that reliably differs between hosts.
  transport   TEXT NOT NULL DEFAULT 'smtp' CHECK (transport IN ('smtp', 'resend_api')),
  active      BOOLEAN NOT NULL DEFAULT false,
  -- Order tried when the active provider fails. Lower first.
  sort_order  INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  -- Written by the functions host after each attempt, so the console can say
  -- "this one is failing" instead of the operator finding out from a merchant.
  last_ok_at    TIMESTAMPTZ,
  last_error    TEXT,
  last_error_at TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.email_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage email providers" ON public.email_providers;
CREATE POLICY "Admins manage email providers"
  ON public.email_providers FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- At most one active provider, enforced by the database rather than by whoever
-- last edited the console. Two active rows would make "which one sent this"
-- unanswerable.
CREATE UNIQUE INDEX IF NOT EXISTS email_providers_one_active
  ON public.email_providers ((active)) WHERE active;

-- Seeded from what is already configured in integration_secrets, so an existing
-- deployment keeps sending mail through exactly the account it does today.
INSERT INTO public.email_providers (id, label, host, port, secure, username, from_name, transport, sort_order, notes)
VALUES
  ('resend', 'Resend', 'smtp.resend.com', 465, true, 'resend', 'CatalogShare', 'smtp', 0,
   'Username is the literal word "resend"; the password is the API key.'),
  ('m365', 'Microsoft 365', 'smtp.office365.com', 587, false, '', 'CatalogShare', 'smtp', 1,
   'Needs SMTP AUTH enabled on the mailbox, and an app password when MFA is on. The From address must be the mailbox itself or a permitted Send As.'),
  ('gmail', 'Gmail / Google Workspace', 'smtp.gmail.com', 465, true, '', 'CatalogShare', 'smtp', 2,
   'Requires a Google App Password, not the account password.'),
  ('custom', 'Custom SMTP', '', 587, false, '', 'CatalogShare', 'smtp', 3,
   'Any other provider — Brevo, Zoho, Amazon SES, a company mail server.')
ON CONFLICT (id) DO NOTHING;

-- Carry the live credentials across from integration_secrets so nothing has to
-- be retyped. Only fills blanks; never overwrites an edit made since.
UPDATE public.email_providers p
   SET host       = COALESCE(NULLIF(p.host, ''),       (SELECT value FROM public.integration_secrets WHERE key = 'SMTP_HOST')),
       username   = COALESCE(NULLIF(p.username, ''),   (SELECT value FROM public.integration_secrets WHERE key = 'SMTP_USER')),
       password   = COALESCE(NULLIF(p.password, ''),   (SELECT value FROM public.integration_secrets WHERE key = 'SMTP_PASS')),
       from_email = COALESCE(NULLIF(p.from_email, ''), (SELECT value FROM public.integration_secrets WHERE key = 'SMTP_FROM')),
       from_name  = COALESCE(NULLIF(p.from_name, ''),  (SELECT value FROM public.integration_secrets WHERE key = 'SMTP_FROM_NAME'))
 WHERE p.id = 'resend';

-- Resend's SMTP password IS the API key, so an operator who only ever filled in
-- RESEND_API_KEY still ends up with a working provider row.
UPDATE public.email_providers
   SET password = (SELECT value FROM public.integration_secrets WHERE key = 'RESEND_API_KEY')
 WHERE id = 'resend'
   AND password = ''
   AND COALESCE((SELECT value FROM public.integration_secrets WHERE key = 'RESEND_API_KEY'), '') <> '';

-- Make Resend active only if nothing is active yet AND it actually has a
-- password. Activating an empty provider would take email down on migrate.
UPDATE public.email_providers
   SET active = true
 WHERE id = 'resend'
   AND password <> ''
   AND NOT EXISTS (SELECT 1 FROM public.email_providers WHERE active);


-- -----------------------------------------------------------------------------
-- 2. whatsapp_templates — Fast2SMS approved templates, by purpose
--
-- `purpose` is what the code asks for; everything else is what Fast2SMS needs.
-- More templates are coming (payment reminder, payment received), and each one
-- must be an INSERT here rather than a code change — that is the whole point of
-- the table.
--
-- `variables` documents the ORDER Fast2SMS expects, because variables_values is
-- a pipe-separated positional list with no names in it. Getting the order wrong
-- produces a delivered message with the fields swapped and no error at all.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  purpose       TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  template_name TEXT NOT NULL DEFAULT '',
  -- Meta's template id. Recorded for traceability; the API does not take it.
  template_id   TEXT NOT NULL DEFAULT '',
  -- THE one Fast2SMS actually needs. Their numeric id for the approved template.
  message_id    TEXT NOT NULL DEFAULT '',
  -- Ordered names of the {{1}}, {{2}}… placeholders, e.g. ["otp","minutes"].
  variables     JSONB NOT NULL DEFAULT '[]'::jsonb,
  active        BOOLEAN NOT NULL DEFAULT true,
  description   TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage whatsapp templates" ON public.whatsapp_templates;
CREATE POLICY "Admins manage whatsapp templates"
  ON public.whatsapp_templates FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- The OTP template as approved. variables is ["otp","minutes"], so
-- variables_values is sent as "482913|10".
INSERT INTO public.whatsapp_templates (purpose, label, template_name, template_id, message_id, variables, description)
VALUES
  ('otp', 'Verification code', 'catalogshareotp', '1980081222689038', '30312',
   '["otp","minutes"]'::jsonb,
   'Sent for signup, login 2FA, password reset and WhatsApp number changes. First variable is the code, second is how many minutes it stays valid.'),
  -- Placeholders for the templates that are coming. Left INACTIVE with a blank
  -- message_id: the sender treats "no message_id" as "not provisioned yet" and
  -- skips silently rather than firing a request Fast2SMS will reject.
  ('payment_reminder', 'Payment reminder', '', '', '', '[]'::jsonb,
   'Not provisioned yet. Fill in the Fast2SMS message id and the variable order, then switch it on.'),
  ('payment_received', 'Payment received', '', '', '', '[]'::jsonb,
   'Not provisioned yet. Fill in the Fast2SMS message id and the variable order, then switch it on.')
ON CONFLICT (purpose) DO NOTHING;

UPDATE public.whatsapp_templates SET active = false WHERE message_id = '' AND active;


-- -----------------------------------------------------------------------------
-- 3. auth_otps — issued codes
--
-- The code is stored as a SHA-256 hash, never in clear. A table of live OTPs in
-- plain text is a table that turns one leaked backup into every account on the
-- platform, and there is no reason to be able to read them back: verification
-- only ever needs to compare.
--
-- NO POLICY AT ALL. Every read and write goes through the functions host with
-- the service role. The old password_reset_otps table had `USING (true)` on
-- SELECT, which let any client read anyone's code.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.auth_otps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'register' | 'login' | 'reset' | 'change_number'
  purpose      TEXT NOT NULL,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- E.164 without the +, e.g. 919663559022. Normalised by the sender.
  phone        TEXT,
  email        TEXT,
  code_hash    TEXT NOT NULL,
  channel      TEXT NOT NULL DEFAULT 'whatsapp',
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  consumed_at  TIMESTAMPTZ,
  request_id   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.auth_otps ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies. Service role only.

CREATE INDEX IF NOT EXISTS auth_otps_lookup_idx
  ON public.auth_otps (purpose, phone, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_otps_user_idx
  ON public.auth_otps (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_otps_expiry_idx
  ON public.auth_otps (expires_at);

-- Housekeeping. Consumed and expired rows are of no value and every one of them
-- is a hash of a code somebody typed.
CREATE OR REPLACE FUNCTION public.purge_expired_otps()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.auth_otps
   WHERE expires_at < now() - INTERVAL '1 day'
      OR (consumed_at IS NOT NULL AND consumed_at < now() - INTERVAL '1 day');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


-- -----------------------------------------------------------------------------
-- 4. Verification state per user
--
-- Separate from `companies` because it is about the ACCOUNT, and a user has a
-- company only after step 2 of registration — which is exactly when the phone
-- has to already be verified.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_security (
  user_id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone              TEXT,
  phone_verified_at  TIMESTAMPTZ,
  -- Set by verify-otp when a login 2FA challenge is passed. The app reads it to
  -- decide whether this account still owes a code.
  last_2fa_at        TIMESTAMPTZ,
  -- Lets an admin exempt one account (their own, a demo login) without turning
  -- 2FA off for everybody.
  two_factor_exempt  BOOLEAN NOT NULL DEFAULT false,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_security ENABLE ROW LEVEL SECURITY;

-- A user may READ their own row (the app needs to know whether it owes a code)
-- but may never write it: every field here is a claim about identity, and a
-- client that can set `phone_verified_at` has defeated the entire feature.
DROP POLICY IF EXISTS "Users read own security row" ON public.user_security;
CREATE POLICY "Users read own security row"
  ON public.user_security FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage user security" ON public.user_security;
CREATE POLICY "Admins manage user security"
  ON public.user_security FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Phone lookups: used to find the account behind a password-reset request, and
-- to stop two accounts claiming the same verified number.
CREATE UNIQUE INDEX IF NOT EXISTS user_security_phone_verified_idx
  ON public.user_security (phone) WHERE phone_verified_at IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 5. The switches
--
-- Merged into the existing `auth` row rather than replacing it: it already
-- carries google_web_client_id, written by selfhost-smtp-reconcile.sh, and a
-- plain INSERT would blow that away and hide the Google button.
-- -----------------------------------------------------------------------------
INSERT INTO public.app_settings (key, value)
VALUES ('auth', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

UPDATE public.app_settings
   SET value = jsonb_build_object(
         -- OFF by default, and that is the deliberate answer to "email is
         -- optional now". While this is false the app never blocks anyone on a
         -- confirmation link, which is the failure that killed registration for
         -- a day when Resend went live.
         'email_verification_enabled', false,
         -- ON. WhatsApp is the permanent channel.
         'whatsapp_verification_enabled', true,
         -- Login 2FA over WhatsApp. Off until the operator has watched the OTP
         -- flow work, because switching it on locks out anyone it cannot reach.
         'two_factor_enabled', false,
         -- Password reset by WhatsApp OTP, alongside the emailed link.
         'whatsapp_reset_enabled', true,
         'otp_length', 6,
         'otp_ttl_minutes', 10,
         'otp_max_attempts', 5,
         -- Seconds before "resend code" becomes available.
         'otp_resend_seconds', 45,
         -- Per phone number, per hour. A WhatsApp message costs money, so this
         -- is a spend cap as much as an abuse control.
         'otp_hourly_limit', 6
       ) || value,
       updated_at = now()
 WHERE key = 'auth';


-- -----------------------------------------------------------------------------
-- 6. Fast2SMS credentials
--
-- The API key is the only secret. The ids are not sensitive, but they live here
-- too so that everything one integration needs is configured in one place.
-- -----------------------------------------------------------------------------
INSERT INTO public.integration_secrets (key, label, description, is_secret) VALUES
  ('FAST2SMS_API_KEY',         'Fast2SMS API key',        'Dev API key from the Fast2SMS dashboard. Sent as the Authorization header.', true),
  ('FAST2SMS_PHONE_NUMBER_ID', 'WhatsApp phone number id','The Phone Number ID of your WABA sender.',                                   false),
  ('FAST2SMS_WABA_ID',         'WABA id',                 'WhatsApp Business Account id. Recorded for support tickets.',                false),
  ('FAST2SMS_SENDER_NUMBER',   'Sender number',           'The number messages come from, e.g. +919663559022.',                         false)
ON CONFLICT (key) DO NOTHING;

-- The ids supplied with the account. The API key stays blank — it is a secret
-- and belongs in the console, not in a file in the repository.
UPDATE public.integration_secrets SET value = '1239867092548940'
 WHERE key = 'FAST2SMS_PHONE_NUMBER_ID' AND value = '';
UPDATE public.integration_secrets SET value = '3418956211603189'
 WHERE key = 'FAST2SMS_WABA_ID' AND value = '';
UPDATE public.integration_secrets SET value = '+919663559022'
 WHERE key = 'FAST2SMS_SENDER_NUMBER' AND value = '';


-- -----------------------------------------------------------------------------
-- 7. admin_* helpers for the console
-- -----------------------------------------------------------------------------

-- List providers WITHOUT their passwords, the same rule
-- admin_list_integration_settings follows: report whether one is set, never
-- what it is.
CREATE OR REPLACE FUNCTION public.admin_list_email_providers()
RETURNS TABLE (
  id TEXT, label TEXT, host TEXT, port INTEGER, secure BOOLEAN, username TEXT,
  from_email TEXT, from_name TEXT, reply_to TEXT, transport TEXT,
  active BOOLEAN, sort_order INTEGER, notes TEXT, password_set BOOLEAN,
  last_ok_at TIMESTAMPTZ, last_error TEXT, last_error_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators may read email providers';
  END IF;

  RETURN QUERY
  SELECT p.id, p.label, p.host, p.port, p.secure, p.username,
         p.from_email, p.from_name, p.reply_to, p.transport,
         p.active, p.sort_order, p.notes, (p.password <> '') AS password_set,
         p.last_ok_at, p.last_error, p.last_error_at
    FROM public.email_providers p
   ORDER BY p.sort_order, p.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_email_providers() TO authenticated;


-- Write one provider. A blank password means "leave it alone", for the same
-- reason admin_set_integration_secret does: the console never receives the
-- stored password, so a plain UPDATE from an edited form would blank it and
-- take email down for a reason nobody would connect to the edit.
CREATE OR REPLACE FUNCTION public.admin_save_email_provider(
  p_id TEXT, p_label TEXT, p_host TEXT, p_port INTEGER, p_secure BOOLEAN,
  p_username TEXT, p_password TEXT, p_from_email TEXT, p_from_name TEXT,
  p_reply_to TEXT, p_transport TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators may change email providers';
  END IF;

  INSERT INTO public.email_providers AS e
    (id, label, host, port, secure, username, password, from_email, from_name, reply_to, transport, updated_at, updated_by)
  VALUES
    (p_id, COALESCE(NULLIF(p_label, ''), p_id), COALESCE(p_host, ''), COALESCE(p_port, 587),
     COALESCE(p_secure, false), COALESCE(p_username, ''), COALESCE(p_password, ''),
     COALESCE(p_from_email, ''), COALESCE(p_from_name, 'CatalogShare'), COALESCE(p_reply_to, ''),
     COALESCE(NULLIF(p_transport, ''), 'smtp'), now(), auth.uid())
  ON CONFLICT (id) DO UPDATE SET
    label      = COALESCE(NULLIF(EXCLUDED.label, ''), e.label),
    host       = EXCLUDED.host,
    port       = EXCLUDED.port,
    secure     = EXCLUDED.secure,
    username   = EXCLUDED.username,
    password   = CASE WHEN COALESCE(p_password, '') = '' THEN e.password ELSE p_password END,
    from_email = EXCLUDED.from_email,
    from_name  = EXCLUDED.from_name,
    reply_to   = EXCLUDED.reply_to,
    transport  = EXCLUDED.transport,
    updated_at = now(),
    updated_by = auth.uid();

  RETURN jsonb_build_object('ok', true, 'password_kept', COALESCE(p_password, '') = '');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_save_email_provider(TEXT, TEXT, TEXT, INTEGER, BOOLEAN, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- Switch the active provider. One statement, so there is never an instant with
-- none active or two active.
CREATE OR REPLACE FUNCTION public.admin_activate_email_provider(p_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_password TEXT;
  v_host     TEXT;
  v_transport TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators may change the active email provider';
  END IF;

  SELECT password, host, transport INTO v_password, v_host, v_transport
    FROM public.email_providers WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No email provider with id %', p_id;
  END IF;

  -- Refuse to activate one that cannot send. Doing this in the console instead
  -- would leave the check bypassable, and the symptom of getting it wrong is
  -- every password reset silently failing.
  IF COALESCE(v_password, '') = '' THEN
    RAISE EXCEPTION 'That provider has no password set yet';
  END IF;
  IF v_transport = 'smtp' AND COALESCE(v_host, '') = '' THEN
    RAISE EXCEPTION 'That provider has no SMTP host set yet';
  END IF;

  UPDATE public.email_providers
     SET active = (id = p_id), updated_at = now(), updated_by = auth.uid()
   WHERE active OR id = p_id;

  RETURN jsonb_build_object('ok', true, 'active', p_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_activate_email_provider(TEXT) TO authenticated;


-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'email_providers'    AS object, CASE WHEN to_regclass('public.email_providers')    IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'whatsapp_templates',  CASE WHEN to_regclass('public.whatsapp_templates') IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'auth_otps',           CASE WHEN to_regclass('public.auth_otps')          IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'user_security',       CASE WHEN to_regclass('public.user_security')      IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'otp template message_id',
       COALESCE((SELECT NULLIF(message_id, '') FROM public.whatsapp_templates WHERE purpose = 'otp'), 'NOT SET')
UNION ALL SELECT 'active email provider',
       COALESCE((SELECT id FROM public.email_providers WHERE active), 'NONE — email will not send')
UNION ALL SELECT 'Fast2SMS API key',
       CASE WHEN COALESCE((SELECT value FROM public.integration_secrets WHERE key = 'FAST2SMS_API_KEY'), '') <> ''
            THEN 'OK' ELSE 'NOT SET — paste it in the admin console' END
UNION ALL SELECT 'auth_otps is service-role only',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'auth_otps')
            THEN 'OK' ELSE 'HAS POLICIES — check them' END;
