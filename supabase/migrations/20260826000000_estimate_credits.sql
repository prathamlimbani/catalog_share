-- =============================================================================
-- Estimate credits replace the free trial.
--
-- The 5-day trial and the daily upsell dialog are gone. In their place, an
-- estimate on an ad-funded plan is bought with rewarded ads: 2 ads to create
-- one, 1 ad to edit one, capped at 20 ads in any rolling 6 hours.
--
-- Which plans pay is decided by `plans.unlocks_estimates`, so it stays a row
-- edit rather than a release:
--
--   free               ad-funded   (unlocks_estimates = false, already)
--   growth   ₹199      ad-funded   (flipped to false by this migration)
--   pro      ₹349      free
--   estimate ₹399      free
--   support  ₹499      free
--
-- Apply with:  supabase db push  /  psql -f
-- Idempotent.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The credit economy
--
-- ON CONFLICT DO NOTHING, like every other settings seed here: re-running must
-- never revert a number the owner has since changed in the console.
-- -----------------------------------------------------------------------------
INSERT INTO public.app_settings (key, value) VALUES
  ('estimate_credits', jsonb_build_object(
      -- The kill switch. Making a merchant watch an ad before work they have
      -- already typed can be saved is the pattern Google Play's Ads policy
      -- calls interfering with app functionality. If a review is ever rejected
      -- on it, set this to false: it reaches every installed copy immediately,
      -- with no release and no Play review. Balances already banked survive and
      -- spend again the moment it goes back on.
      'enabled',            true,
      'ads_per_estimate',   2,
      -- Never 0. A free edit turns one credited estimate into an unlimited one:
      -- save a blank, then re-edit it into every job for the rest of the month.
      'ads_per_edit',       1,
      -- One estimate, free, once per account. Applied the first time a merchant
      -- opens the Estimates screen, which is also how it reaches the accounts
      -- whose trial this migration is taking away.
      'welcome_credits',    2,
      -- A ROLLING window, not a fixed bucket: the slot frees up 6 hours after
      -- the ad that filled it, not at a clock boundary.
      'watch_limit',        20,
      'watch_window_hours', 6
  ))
ON CONFLICT (key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2. End the trial
--
-- The client no longer reads `app_settings.trial` at all — src/lib/trial.ts and
-- src/lib/trialConfig.ts are deleted — so this is belt and braces for any older
-- build still in the field: it stops them starting new trials and ends the ones
-- running. `companies.trial_started_at` and `trial_consumed` are left in place
-- as history, and so is start_estimate_trial(), which now simply never fires
-- because auto_start is off.
-- -----------------------------------------------------------------------------
UPDATE public.app_settings
   SET value = value
             || jsonb_build_object('enabled', false, 'auto_start', false),
       updated_at = now()
 WHERE key = 'trial';


-- -----------------------------------------------------------------------------
-- 3. The old save gate is gone
--
-- `free_daily_estimates` and `save_gate_mode` drove the per-day quota gate in
-- src/lib/rewardedGate.ts, which the credit wallet replaces. Stripping the keys
-- keeps this row matching exactly what the console now writes, so the next save
-- from the admin screen is not a silent schema change.
-- -----------------------------------------------------------------------------
UPDATE public.app_settings
   SET value = value - 'free_daily_estimates' - 'save_gate_mode',
       updated_at = now()
 WHERE key = 'ads';


-- -----------------------------------------------------------------------------
-- 4. Growth becomes the ad-funded estimate tier
--
-- Growth keeps the estimate generator; it stops including it outright. Written
-- unconditionally rather than ON CONFLICT DO NOTHING because this is the whole
-- point of the migration — the seed row says `true` and has to move.
-- -----------------------------------------------------------------------------
UPDATE public.plans
   SET unlocks_estimates = false,
       features = ARRAY[
         'Up to 300 Products',
         'Estimates (ad-funded)',
         'Better Visibility',
         'Premium Themes',
         'No banner ads',
         'Standard Support'
       ],
       updated_at = now()
 WHERE id = 'growth';

-- The three plans that DO include estimates outright. Stated explicitly so a
-- database seeded before the estimate plans existed cannot leave a paying Pro
-- or Support merchant watching ads.
UPDATE public.plans
   SET unlocks_estimates = true,
       updated_at = now()
 WHERE id IN ('pro', 'estimate_generate', 'support')
   AND unlocks_estimates IS DISTINCT FROM true;


-- -----------------------------------------------------------------------------
-- 5. Ad policy per plan
--
-- `daily_estimates` drove the deleted quota gate and is now read by nothing;
-- zeroed so a stale number cannot mislead whoever reads this table next. The
-- column is kept rather than dropped so an older client still in the field
-- reads 0 (= unlimited, gate off) instead of erroring on a missing column.
--
-- `show_rewarded` is turned on for every ad-funded plan. It is not what permits
-- the credit flow — a rewarded ad is user-initiated and always allowed, which
-- is why a paying merchant can still earn points — but leaving it false here
-- would be a lie about what those plans see.
-- -----------------------------------------------------------------------------
UPDATE public.plan_ad_policy SET daily_estimates = 0, updated_at = now()
 WHERE daily_estimates <> 0;

UPDATE public.plan_ad_policy SET show_rewarded = true, updated_at = now()
 WHERE plan_id IN ('free', 'growth') AND show_rewarded IS DISTINCT FROM true;


-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'estimate_credits settings' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'estimate_credits')
            THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'ads per estimate',
       COALESCE((SELECT value->>'ads_per_estimate' FROM public.app_settings
                  WHERE key = 'estimate_credits'), 'MISSING')
UNION ALL SELECT 'watch limit / hours',
       COALESCE((SELECT (value->>'watch_limit') || ' per ' || (value->>'watch_window_hours') || 'h'
                   FROM public.app_settings WHERE key = 'estimate_credits'), 'MISSING')
UNION ALL SELECT 'trial switched off',
       CASE WHEN (SELECT (value->>'enabled')::BOOLEAN FROM public.app_settings WHERE key = 'trial')
            THEN 'STILL ON' ELSE 'OK' END
UNION ALL SELECT 'growth is ad-funded',
       CASE WHEN (SELECT unlocks_estimates FROM public.plans WHERE id = 'growth')
            THEN 'STILL FREE' ELSE 'OK' END
UNION ALL SELECT 'pro / estimate / support are free',
       CASE WHEN (SELECT count(*) FROM public.plans
                   WHERE id IN ('pro','estimate_generate','support') AND unlocks_estimates) = 3
            THEN 'OK' ELSE 'CHECK' END;
