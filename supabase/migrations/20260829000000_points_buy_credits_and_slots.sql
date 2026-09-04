-- =============================================================================
-- Points stop buying plan days. They buy estimates and product slots instead.
--
-- WHY
--   Redeeming "Growth for 3 days" has never worked in the field. The grant
--   writes companies.subscription_plan, which guard_company_subscription_columns
--   (20260819000001) refuses for anyone but the service role and admins, so the
--   whole function aborts with SQLSTATE P0001 and the merchant reads "could not
--   redeem". 20260825000000 fixes the guard, but the reward itself was also the
--   wrong shape: three days of a plan is a cliff -- it arrives, it is gone, and
--   nothing the merchant did with it survives.
--
--   What points buy now cannot expire and cannot be taken back:
--     100 points -> 5 estimates
--     200 points -> 10 estimates
--     250 points -> +5 products, permanently
--
--   Neither of the first two touches a guarded column at all, so the class of
--   bug that killed redemption cannot recur on that path. The third touches one
--   NEW guarded column and announces itself with the same app.plan_grant flag
--   the coupon and plan grants use.
--
-- WHAT THIS FILE DOES
--   1. reward_offers gains `kind` and `amount`; plan_id/days become optional
--   2. reward_redemptions records the same, plus applied_at for credit grants
--   3. companies gains bonus_product_limit, and the guard learns to protect it
--   4. redeem_reward_offer branches on kind (and keeps the app.plan_grant fix,
--      so this file is safe to apply whether or not 20260825000000 ran)
--   5. claim_reward_credit_grant lets a device stamp a grant it has banked
--   6. the four day-based offers are retired and the three new ones seeded
--
-- WHY ESTIMATE CREDITS NEED A GRANT QUEUE
--   The estimate wallet is device-local (src/lib/estimateCredits.ts) -- that is
--   deliberate, because estimates are offline-first. The server therefore
--   cannot hand credits over directly. It records what was bought and leaves
--   applied_at NULL; the phone banks it, then stamps applied_at so a reinstall
--   cannot claim the same purchase twice.
--
-- APPLY IT (self-hosted, on 103.233.65.233 -- see SELF-HOSTING.md):
--   sudo -u postgres psql -d catalogshare -f 20260829000000_points_buy_credits_and_slots.sql
--
-- The last SELECT prints a row per object; every status must read OK.
-- Idempotent; safe to re-run.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. What an offer can be
--
-- `kind` decides which of the other columns matter:
--   'plan_days'        -> plan_id + days   (the original behaviour, now retired)
--   'estimate_credits' -> amount = estimates granted
--   'product_slots'    -> amount = permanent product-limit increase
--
-- plan_id and days lose their NOT NULL rather than being filled with a
-- placeholder: an offer that grants estimates has no plan and no duration, and
-- writing 'growth'/0 there to satisfy a constraint would be a lie the admin
-- console would then display. The existing CHECK (days > 0) is left in place --
-- a NULL passes it, which is exactly right.
-- -----------------------------------------------------------------------------
ALTER TABLE public.reward_offers
  ADD COLUMN IF NOT EXISTS kind   TEXT    NOT NULL DEFAULT 'plan_days',
  ADD COLUMN IF NOT EXISTS amount INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.reward_offers ALTER COLUMN plan_id DROP NOT NULL;
ALTER TABLE public.reward_offers ALTER COLUMN days    DROP NOT NULL;

ALTER TABLE public.reward_offers DROP CONSTRAINT IF EXISTS reward_offers_kind_check;
ALTER TABLE public.reward_offers
  ADD CONSTRAINT reward_offers_kind_check
  CHECK (kind IN ('plan_days', 'estimate_credits', 'product_slots'));

-- Each kind has to carry the field it is defined by. Without this an offer can
-- be saved that costs points and grants nothing, and the merchant only finds
-- out after spending.
ALTER TABLE public.reward_offers DROP CONSTRAINT IF EXISTS reward_offers_shape_check;
ALTER TABLE public.reward_offers
  ADD CONSTRAINT reward_offers_shape_check
  CHECK (
    -- COALESCE, not a bare `days >= 1`: a NULL there makes the comparison NULL,
    -- the OR below NULL, and a CHECK that evaluates to NULL PASSES. Without it
    -- a plan-days offer with no days at all would be accepted and would then
    -- grant an interval of nothing.
    (kind = 'plan_days' AND plan_id IS NOT NULL AND COALESCE(days, 0) >= 1)
    OR (kind IN ('estimate_credits', 'product_slots') AND COALESCE(amount, 0) >= 1)
  );


-- -----------------------------------------------------------------------------
-- 2. What a redemption records
--
-- `credits` is stored ALONGSIDE `amount` rather than derived on the device.
-- amount is what was sold ("5 estimates"); credits is what that costs in wallet
-- terms at the moment of sale (5 x ads_per_estimate). If the owner reprices an
-- estimate tomorrow, a grant bought today is still worth what it was worth
-- today -- and the receipt says so.
--
-- applied_at is NULL until a device banks the grant. It is the only thing
-- standing between "clear app data" and an infinite estimate refill.
-- -----------------------------------------------------------------------------
ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS kind       TEXT    NOT NULL DEFAULT 'plan_days',
  ADD COLUMN IF NOT EXISTS amount     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

ALTER TABLE public.reward_redemptions ALTER COLUMN plan_id       DROP NOT NULL;
ALTER TABLE public.reward_redemptions ALTER COLUMN days          DROP NOT NULL;
ALTER TABLE public.reward_redemptions ALTER COLUMN granted_until DROP NOT NULL;

-- The device asks "what have I bought that I have not banked yet" every time
-- the Estimates screen opens, so it gets its own partial index.
CREATE INDEX IF NOT EXISTS reward_redemptions_unapplied_idx
  ON public.reward_redemptions (company_id)
  WHERE kind = 'estimate_credits' AND applied_at IS NULL;


-- -----------------------------------------------------------------------------
-- 3. Product slots the merchant owns outright
--
-- Added to the plan's limit, never replacing it: buying 5 slots on Free and
-- then paying for Growth gives 305, not 45. It survives a downgrade too, which
-- is the point -- this was paid for with attention that has already been spent.
-- -----------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS bonus_product_limit INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_bonus_product_limit_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_bonus_product_limit_check
  CHECK (bonus_product_limit >= 0 AND bonus_product_limit <= 5000);


-- -----------------------------------------------------------------------------
-- 4. The guard now also protects bonus_product_limit
--
-- "Owners can update their company" is a PATCH on ANY column, so without this
-- one PostgREST call from a browser console sets bonus_product_limit to 5000
-- and the product cap stops meaning anything. Same exemptions as the
-- subscription columns, same transaction-local flag.
--
-- Re-created in full here so this file stands alone: a database that never had
-- 20260825000000 applied gets the app.plan_grant exemption from this migration
-- instead, which is what makes redeem_reward_offer work at all.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_company_subscription_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- The service role (edge functions) and platform admins bypass the guard.
  IF auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- start_estimate_trial's flag. The trial is gone, but an older client in the
  -- field can still call it, and removing the exemption would turn that call
  -- into an exception instead of the no-op it now is.
  IF current_setting('app.trial_grant', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- A sanctioned grant: redeem_reward_offer or claim_full_coupon.
  --
  -- SECURITY DEFINER changes the executing ROLE, not the request.jwt GUC that
  -- auth.role() reads, so those functions are still 'authenticated' in here and
  -- the checks above do not cover them. They announce themselves instead.
  -- set_config(..., true) cannot outlive the statement's transaction, and a
  -- client PostgREST call is one statement per transaction, so nothing but
  -- those functions can raise this before an UPDATE reaches the guard.
  IF current_setting('app.plan_grant', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan
     OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.trial_started_at IS DISTINCT FROM OLD.trial_started_at
     OR NEW.bonus_product_limit IS DISTINCT FROM OLD.bonus_product_limit THEN
    RAISE EXCEPTION
      'Subscription, trial, ownership and bonus-limit fields cannot be changed directly. Complete a payment or redeem a reward instead.';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_company_subscription_columns ON public.companies;
CREATE TRIGGER guard_company_subscription_columns
  BEFORE UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_company_subscription_columns();


-- -----------------------------------------------------------------------------
-- 5. redeem_reward_offer, now three functions in one
--
-- The shared parts -- signed in, offer exists, company row locked, balance
-- covers the cost, ledger debited -- run once at the top. Only the grant
-- differs, and each branch returns a `kind` so the client knows what to say
-- and what to refresh.
--
-- The "you are on a paid plan already" refusal is deliberately confined to the
-- plan_days branch. Estimates and product slots are things a PAYING merchant
-- has every reason to buy, and refusing them because a subscription is live
-- would be the redemption failing for the second time in this feature's life.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_reward_offer(p_offer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  o            public.reward_offers%ROWTYPE;
  v_company    public.companies%ROWTYPE;
  v_balance    INTEGER;
  v_from       TIMESTAMPTZ;
  v_until      TIMESTAMPTZ;
  v_redemption UUID;
  v_per        INTEGER;
  v_credits    INTEGER;
  v_limit      INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not signed in.');
  END IF;

  SELECT * INTO o FROM public.reward_offers WHERE id = p_offer_id AND active LIMIT 1;
  IF o.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'That reward is no longer available.');
  END IF;

  -- FOR UPDATE serialises two redemptions from the same account.
  SELECT * INTO v_company FROM public.companies
   WHERE owner_id = auth.uid() LIMIT 1 FOR UPDATE;

  IF v_company.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Set up your company first.');
  END IF;

  SELECT COALESCE(SUM(delta), 0) INTO v_balance
    FROM public.points_ledger WHERE company_id = v_company.id;

  IF v_balance < o.points_cost THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not enough points.',
                              'balance', v_balance, 'needed', o.points_cost);
  END IF;

  -- ---------------------------------------------------------------- estimates
  IF o.kind = 'estimate_credits' THEN
    -- Priced at today's rate and frozen into the row. The device banks
    -- `credits`; `amount` is what the merchant was told they bought.
    -- The regex is not decoration. app_settings is admin-typed JSON, and a
    -- '2.5' or a '' in there would make the ::INTEGER cast raise, aborting the
    -- whole redemption. Rolling back means no points are lost, but the merchant
    -- gets an unexplainable failure on a screen this feature has already failed
    -- on once. An unreadable value falls back to the shipped default instead.
    v_per := GREATEST(1, COALESCE(
      (SELECT CASE WHEN value->>'ads_per_estimate' ~ '^[0-9]+$'
                   THEN (value->>'ads_per_estimate')::INTEGER END
         FROM public.app_settings WHERE key = 'estimate_credits'), 2));
    v_credits := o.amount * v_per;

    INSERT INTO public.reward_redemptions
      (company_id, offer_id, kind, amount, credits, points_spent)
    VALUES (v_company.id, o.id, o.kind, o.amount, v_credits, o.points_cost)
    RETURNING id INTO v_redemption;

    INSERT INTO public.points_ledger (company_id, delta, reason, ref, note)
    VALUES (v_company.id, -o.points_cost, 'redemption', v_redemption::TEXT, o.label);

    RETURN jsonb_build_object(
      'ok', true, 'kind', o.kind, 'amount', o.amount, 'credits', v_credits,
      'grant_id', v_redemption, 'spent', o.points_cost,
      'balance', v_balance - o.points_cost);
  END IF;

  -- ------------------------------------------------------------ product slots
  IF o.kind = 'product_slots' THEN
    INSERT INTO public.reward_redemptions
      (company_id, offer_id, kind, amount, points_spent, applied_at)
    VALUES (v_company.id, o.id, o.kind, o.amount, o.points_cost, now())
    RETURNING id INTO v_redemption;

    INSERT INTO public.points_ledger (company_id, delta, reason, ref, note)
    VALUES (v_company.id, -o.points_cost, 'redemption', v_redemption::TEXT, o.label);

    -- Transaction-local, and lowered again immediately: the exemption covers
    -- this one UPDATE and nothing else that might run later in this
    -- transaction.
    PERFORM set_config('app.plan_grant', 'on', true);

    UPDATE public.companies
       SET bonus_product_limit = LEAST(5000, COALESCE(bonus_product_limit, 0) + o.amount)
     WHERE id = v_company.id
     RETURNING bonus_product_limit INTO v_limit;

    PERFORM set_config('app.plan_grant', 'off', true);

    RETURN jsonb_build_object(
      'ok', true, 'kind', o.kind, 'amount', o.amount, 'bonus_product_limit', v_limit,
      'spent', o.points_cost, 'balance', v_balance - o.points_cost);
  END IF;

  -- ----------------------------------------------------------------- plan days
  -- Never shorten what someone already paid for. A merchant on a live PAID plan
  -- redeeming a DIFFERENT plan would be a downgrade, so refuse and say why
  -- rather than quietly taking their points.
  IF v_company.subscription_plan IS NOT NULL
     AND v_company.subscription_plan <> 'free'
     AND v_company.subscription_expires_at IS NOT NULL
     AND v_company.subscription_expires_at > now()
     AND v_company.subscription_plan <> o.plan_id THEN
    RETURN jsonb_build_object('ok', false,
      'reason', format('You are on the %s plan until %s. Redeem this once it ends.',
                       v_company.subscription_plan,
                       to_char(v_company.subscription_expires_at, 'DD Mon YYYY')));
  END IF;

  -- Extend from the later of now and the current expiry, so redeeming twice
  -- stacks instead of overwriting.
  v_from  := GREATEST(COALESCE(v_company.subscription_expires_at, now()), now());
  v_until := v_from + (o.days || ' days')::INTERVAL;

  INSERT INTO public.reward_redemptions
    (company_id, offer_id, kind, plan_id, days, points_spent, granted_until, applied_at)
  VALUES (v_company.id, o.id, o.kind, o.plan_id, o.days, o.points_cost, v_until, now())
  RETURNING id INTO v_redemption;

  INSERT INTO public.points_ledger (company_id, delta, reason, ref, note)
  VALUES (v_company.id, -o.points_cost, 'redemption', v_redemption::TEXT, o.label);

  PERFORM set_config('app.plan_grant', 'on', true);

  UPDATE public.companies
     SET subscription_plan = o.plan_id,
         subscription_expires_at = v_until
   WHERE id = v_company.id;

  PERFORM set_config('app.plan_grant', 'off', true);

  RETURN jsonb_build_object('ok', true, 'kind', o.kind, 'plan', o.plan_id, 'days', o.days,
                            'until', v_until, 'spent', o.points_cost,
                            'balance', v_balance - o.points_cost);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.redeem_reward_offer(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. claim_reward_credit_grant -- the device says "I have banked this one"
--
-- reward_redemptions has no UPDATE policy for merchants, and it must not get
-- one: a client that can write this table can un-apply its own grants and
-- re-bank them forever. The stamp goes through a function that can only ever
-- move applied_at from NULL to now(), and only on a row the caller's own
-- company owns.
--
-- Idempotent by design -- an already-stamped grant returns ok, because the
-- device retries this on every launch until it succeeds, and a retry that
-- errors would look to the client like a grant it still has to bank.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_reward_credit_grant(p_grant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_company UUID;
  v_row     public.reward_redemptions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not signed in.');
  END IF;

  SELECT id INTO v_company FROM public.companies WHERE owner_id = auth.uid() LIMIT 1;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'No company.');
  END IF;

  SELECT * INTO v_row FROM public.reward_redemptions
   WHERE id = p_grant_id AND company_id = v_company
   LIMIT 1 FOR UPDATE;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'No such grant.');
  END IF;

  IF v_row.applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  UPDATE public.reward_redemptions SET applied_at = now() WHERE id = p_grant_id;

  RETURN jsonb_build_object('ok', true, 'credits', v_row.credits);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.claim_reward_credit_grant(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. Retire the day-based offers, seed the three that replace them
--
-- Deactivated rather than deleted: reward_redemptions.offer_id points at them,
-- and an operator who wants plan days back only has to flip `active` -- the
-- plan_days branch above still works, and now actually grants.
--
-- Pricing, at 10 points per ad and a cap of 10 ads a day (100 points/day):
--   5 estimates  for 100 = 10 ads. The estimates themselves cost 10 ads if
--                                  watched directly, so points buy nothing the
--                                  merchant could not earn -- they are the
--                                  reason to keep earning past the daily cap.
--   10 estimates for 200 = 20 ads. Same rate, one fewer trip to the screen.
--   +5 products  for 250 = 25 ads, two and a half days of watching, permanent.
-- -----------------------------------------------------------------------------
UPDATE public.reward_offers
   SET active = false
 WHERE kind = 'plan_days' AND active;

INSERT INTO public.reward_offers (label, kind, amount, points_cost, sort_order, active)
SELECT v.label, v.kind, v.amount, v.points_cost, v.sort_order, true
  FROM (VALUES
    ('5 estimates',        'estimate_credits', 5,  100, 1),
    ('10 estimates',       'estimate_credits', 10, 200, 2),
    ('+5 products, forever','product_slots',   5,  250, 3)
  ) AS v(label, kind, amount, points_cost, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.reward_offers r
    WHERE r.kind = v.kind AND r.amount = v.amount
 );


-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'reward_offers.kind' AS object,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='reward_offers'
                            AND column_name='kind')
            THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'reward_redemptions.applied_at',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='reward_redemptions'
                            AND column_name='applied_at')
            THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'companies.bonus_product_limit',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='companies'
                            AND column_name='bonus_product_limit')
            THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'guard protects bonus_product_limit',
       CASE WHEN (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
                   WHERE p.proname='guard_company_subscription_columns' LIMIT 1)
                 LIKE '%bonus_product_limit%'
            THEN 'OK' ELSE 'STALE' END
UNION ALL SELECT 'redeem_reward_offer knows kinds',
       CASE WHEN (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
                   WHERE p.proname='redeem_reward_offer' LIMIT 1)
                 LIKE '%estimate_credits%'
            THEN 'OK' ELSE 'STALE' END
UNION ALL SELECT 'claim_reward_credit_grant()',
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='claim_reward_credit_grant')
            THEN 'OK' ELSE 'MISSING' END
-- Not fixed by this file. If it reads STALE, 20260825000000 has never been
-- applied and 100%-off coupons still die on the guard.
UNION ALL SELECT 'claim_full_coupon raises the flag',
       CASE WHEN (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
                   WHERE p.proname='claim_full_coupon' LIMIT 1)
                 LIKE '%app.plan_grant%'
            THEN 'OK' ELSE 'STALE - apply 20260825000000' END
UNION ALL SELECT 'active offers',
       COALESCE((SELECT string_agg(label || ' (' || points_cost || ')', ', ' ORDER BY sort_order)
                   FROM public.reward_offers WHERE active), 'NONE');
