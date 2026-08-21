-- =============================================================================
-- Admin control over the trial, and a fix for trials being handed out on
-- downgrade.
--
-- Apply with:  supabase db push  /  psql -f
-- Idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The trial becomes configurable
--
-- Length and what it unlocks were constants in the bundle, so changing either
-- meant a release - and on Android, a release nobody installs for weeks.
-- -----------------------------------------------------------------------------
INSERT INTO public.app_settings (key, value) VALUES
  ('trial', jsonb_build_object(
      'enabled',           true,
      'duration_days',     5,
      -- What the trial is worth. Estimates is the whole point of it today, but
      -- the others are here so a promotion can widen it without a release.
      'unlocks_estimates', true,
      'unlocks_premium_themes', false,
      'product_limit',     40,
      -- Whether opening the Estimates screen starts the clock. Turning this off
      -- makes the trial invite-only: only an admin grant can start one.
      'auto_start',        true,
      -- See below. A merchant who has already paid has had their trial; letting
      -- a downgrade restart it turns "cancel and resubscribe" into a free ride.
      'allow_after_paid',  false
  ))
ON CONFLICT (key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2. companies.trial_consumed
--
-- A trial that has ended must stay ended. `trial_started_at IS NULL` was doing
-- double duty as "never had one", which is wrong for a merchant who paid
-- without ever trialling: downgrading them to free made the app start a fresh
-- five days.
-- -----------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS trial_consumed BOOLEAN NOT NULL DEFAULT false;

-- Anyone who has already started one, or has ever held a paid plan, has had
-- their go. Backfilled once so existing accounts are not handed a new trial the
-- first time they are downgraded.
UPDATE public.companies c
   SET trial_consumed = true
 WHERE trial_consumed = false
   AND (
     c.trial_started_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.company_id = c.id)
   );


-- -----------------------------------------------------------------------------
-- 3. start_estimate_trial — honour the config and the consumed flag
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_estimate_trial(p_company_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started    TIMESTAMPTZ;
  v_consumed   BOOLEAN;
  v_cfg        JSONB;
  v_enabled    BOOLEAN;
  v_auto       BOOLEAN;
  v_after_paid BOOLEAN;
  v_has_paid   BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = p_company_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorised for this company';
  END IF;

  SELECT trial_started_at, trial_consumed INTO v_started, v_consumed
    FROM public.companies WHERE id = p_company_id;

  -- Already running or already used: return what is there, never restart.
  IF v_started IS NOT NULL THEN
    RETURN v_started;
  END IF;

  SELECT value INTO v_cfg FROM public.app_settings WHERE key = 'trial';
  v_enabled    := COALESCE((v_cfg->>'enabled')::BOOLEAN, true);
  v_auto       := COALESCE((v_cfg->>'auto_start')::BOOLEAN, true);
  v_after_paid := COALESCE((v_cfg->>'allow_after_paid')::BOOLEAN, false);

  IF NOT v_enabled OR NOT v_auto THEN
    RETURN NULL;
  END IF;

  -- THE FIX. A company that has ever paid has had its trial, so being moved
  -- back to free must not start a new one. Without this, "downgrade me to
  -- free" is a way to get the estimate generator for another five days, every
  -- time.
  SELECT EXISTS (SELECT 1 FROM public.subscriptions WHERE company_id = p_company_id)
    INTO v_has_paid;

  IF COALESCE(v_consumed, false) OR (v_has_paid AND NOT v_after_paid) THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.trial_grant', 'on', true);
  UPDATE public.companies
     SET trial_started_at = now(), trial_consumed = true
   WHERE id = p_company_id
   RETURNING trial_started_at INTO v_started;
  PERFORM set_config('app.trial_grant', 'off', true);

  RETURN v_started;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_estimate_trial(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. admin_grant_trial — the deliberate way to give someone another one
--
-- Now that a trial cannot restart itself, support needs a way to hand one out
-- on purpose: an apology, a demo, a merchant who lost days to an outage.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_grant_trial(p_company_id UUID, p_days INTEGER DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators may grant a trial';
  END IF;

  SELECT COALESCE(p_days, (value->>'duration_days')::INTEGER, 5)
    INTO v_days FROM public.app_settings WHERE key = 'trial';
  v_days := COALESCE(v_days, 5);

  -- Backdate the start so the trial ends exactly p_days from now, whatever the
  -- configured length happens to be. Setting it to now() would silently give
  -- the configured duration instead of the one that was asked for.
  PERFORM set_config('app.trial_grant', 'on', true);
  UPDATE public.companies
     SET trial_started_at = now() - ((COALESCE((SELECT (value->>'duration_days')::INTEGER FROM public.app_settings WHERE key='trial'), 5) - v_days) || ' days')::INTERVAL,
         trial_consumed = true
   WHERE id = p_company_id;
  PERFORM set_config('app.trial_grant', 'off', true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No company with id %', p_company_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'days', v_days);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_grant_trial(UUID, INTEGER) TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. Ads during the trial
--
-- A trial user is on the `free` plan, so the free row already governs them.
-- Making it explicit here, and turning rewarded on, because the point of the
-- trial is to demonstrate the product AND the upgrade path - a trial with no
-- ads teaches people the paid tier removes something they never saw.
-- -----------------------------------------------------------------------------
UPDATE public.plan_ad_policy
   SET show_banner = true, show_interstitial = true, show_rewarded = true
 WHERE plan_id = 'free';


-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'companies.trial_consumed' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='companies' AND column_name='trial_consumed')
            THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'trial settings row',
       CASE WHEN EXISTS (SELECT 1 FROM public.app_settings WHERE key='trial') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'admin_grant_trial()',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_grant_trial') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'free plan shows ads',
       CASE WHEN (SELECT show_banner FROM public.plan_ad_policy WHERE plan_id='free') THEN 'OK' ELSE 'OFF' END;
