-- =============================================================================
-- Sign in with a mobile number, and admin alerts on WhatsApp.
--
-- Three things:
--
--  1. PHONE LOGIN. A merchant types their WhatsApp number instead of an email,
--     gets a code, and is signed in — no password. The session is minted by
--     GoTrue's admin `generate_link` AFTER the code is verified server-side, so
--     the client never holds anything that could produce a session on its own.
--
--  2. THE ADMIN NUMBER. +917625025686 is attached to the account that already
--     holds the admin role, so signing in with it lands in Master Admin. No new
--     admin rights are granted to anyone — deliberately, because the number is
--     also the contact number on the CATALOGSHARE company row, whose owner is a
--     DIFFERENT account with no role. Attaching rather than escalating keeps
--     those two facts from becoming one.
--
--  3. ADMIN ALERTS ON WHATSAPP. Rows for the notification templates, so the
--     moment Meta approves one it is a message id in a row rather than a
--     release. Every one starts INACTIVE with a blank message id, which the
--     sender treats as "not provisioned" and skips.
--
-- Apply with:  supabase db push  /  psql -f
-- Idempotent.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Phone login switch
-- -----------------------------------------------------------------------------
UPDATE public.app_settings
   SET value = jsonb_build_object(
         'phone_login_enabled', true,
         -- Whether a merchant whose number is on their company row but has never
         -- been PROVEN may verify it by signing in with it. This is what lets the
         -- existing merchant base use phone login at all — nobody had a verified
         -- number before this feature existed.
         --
         -- It is a real trust decision, not a convenience: it treats "controls
         -- the number on the company row" as proof of ownership of the account.
         -- That is sound only because the code still has to arrive on that
         -- number, and because it is refused when the account already has a
         -- DIFFERENT verified number (see send-otp.mjs) — otherwise a stale row
         -- would be a way in.
         'phone_login_claims_unverified', true
       ) || value,
       updated_at = now()
 WHERE key = 'auth';


-- -----------------------------------------------------------------------------
-- 2. The admin's number
--
-- Attached to whichever account currently holds the admin role, found by lookup
-- rather than hardcoded id, so this is still correct if the role ever moves.
--
-- ON CONFLICT on user_id updates; the partial unique index on a verified phone
-- means this fails loudly if some other account has already proven the same
-- number, which is exactly when a human should look rather than a migration
-- guessing.
-- -----------------------------------------------------------------------------
INSERT INTO public.user_security (user_id, phone, phone_verified_at)
SELECT ur.user_id, '7625025686', now()
  FROM public.user_roles ur
 WHERE ur.role = 'admin'
 ORDER BY ur.user_id
 LIMIT 1
ON CONFLICT (user_id) DO UPDATE
  SET phone = EXCLUDED.phone,
      phone_verified_at = COALESCE(public.user_security.phone_verified_at, EXCLUDED.phone_verified_at),
      updated_at = now();


-- -----------------------------------------------------------------------------
-- 3. Where admin alerts go
-- -----------------------------------------------------------------------------
INSERT INTO public.integration_secrets (key, label, description, is_secret) VALUES
  ('ADMIN_WHATSAPP_NUMBER', 'Admin WhatsApp number',
   'Platform alerts (new company, new subscription, plan change, downgrade) are sent here as well as by email. Indian mobile, any format. Blank switches WhatsApp alerts off.',
   false)
ON CONFLICT (key) DO NOTHING;

UPDATE public.integration_secrets SET value = '+917625025686'
 WHERE key = 'ADMIN_WHATSAPP_NUMBER' AND value = '';


-- -----------------------------------------------------------------------------
-- 4. Templates for the alerts
--
-- One row per notification the email side already sends to the admin. All
-- inactive with a blank message_id until Meta approves them through Fast2SMS —
-- `sendWhatsApp` returns `not_provisioned` for those and the caller carries on,
-- so nothing breaks while they are pending.
--
-- `variables` records the ORDER the approved template will expect. Fill these in
-- to match the real template when it is approved; the list is positional and
-- getting it wrong delivers a message with the fields swapped and no error.
-- -----------------------------------------------------------------------------
INSERT INTO public.whatsapp_templates (purpose, label, variables, active, description) VALUES
  ('admin_new_company', 'Admin: new company', '["company","email"]'::jsonb, false,
   'A merchant finished registration. Suggested body: New company {{1}} joined ({{2}}).'),
  ('admin_new_subscription', 'Admin: new subscription', '["company","plan","amount"]'::jsonb, false,
   'A payment succeeded. Suggested body: {{1}} subscribed to {{2}} for Rs {{3}}.'),
  ('admin_plan_change', 'Admin: plan changed', '["company","plan"]'::jsonb, false,
   'A plan was changed by an admin or by payment. Suggested body: {{1}} is now on {{2}}.'),
  ('admin_plan_downgraded', 'Admin: auto-downgrade', '["company","previous"]'::jsonb, false,
   'A subscription lapsed and the account fell back to Free. Suggested body: {{1}} dropped from {{2}} to Free.')
ON CONFLICT (purpose) DO NOTHING;


-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'phone login enabled' AS object,
       COALESCE((SELECT value->>'phone_login_enabled' FROM public.app_settings WHERE key='auth'), 'MISSING') AS status
UNION ALL SELECT 'admin number attached to',
       COALESCE((SELECT u.email FROM public.user_security s
                   JOIN auth.users u ON u.id = s.user_id
                  WHERE s.phone = '7625025686' AND s.phone_verified_at IS NOT NULL), 'NOT ATTACHED')
UNION ALL SELECT 'that account is an admin',
       CASE WHEN EXISTS (
              SELECT 1 FROM public.user_security s
                JOIN public.user_roles r ON r.user_id = s.user_id AND r.role = 'admin'
               WHERE s.phone = '7625025686' AND s.phone_verified_at IS NOT NULL)
            THEN 'OK' ELSE 'NO — phone login will not reach Master Admin' END
UNION ALL SELECT 'admin whatsapp number',
       COALESCE(NULLIF((SELECT value FROM public.integration_secrets WHERE key='ADMIN_WHATSAPP_NUMBER'), ''), 'NOT SET')
UNION ALL SELECT 'alert templates awaiting approval',
       (SELECT count(*)::text FROM public.whatsapp_templates
         WHERE purpose LIKE 'admin_%' AND COALESCE(message_id,'') = '');
