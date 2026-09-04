-- =============================================================================
-- Let a points redemption actually grant the plan it was paid for.
--
-- THE BUG
--   A merchant watches rewarded ads, the points arrive, and Redeem does nothing
--   but say "Could not redeem right now. Please try again."
--
--   guard_company_subscription_columns() (20260819000001) is a BEFORE UPDATE
--   trigger on public.companies that RAISEs whenever subscription_plan or
--   subscription_expires_at changes, unless the caller is the service role, a
--   platform admin, or has raised the transaction-local `app.trial_grant` flag.
--
--   redeem_reward_offer() runs as the MERCHANT -- SECURITY DEFINER changes the
--   executing role, not the request.jwt GUC that auth.role() reads, exactly as
--   20260819000001's own comment records for start_estimate_trial. So its final
--
--     UPDATE public.companies SET subscription_plan = ..., subscription_expires_at = ...
--
--   trips the guard, the whole function aborts with SQLSTATE P0001, and the
--   client turns that into a generic apology. claim_full_coupon() has the
--   identical defect, so 100%-off coupons never granted anything either.
--
--   EARNING was never affected: the SSV callback writes points_ledger and
--   ad_reward_events under the service role and never touches companies.
--
--   It also worked for the OWNER'S OWN ACCOUNT, because the guard exempts
--   admins -- which is why it survived testing.
--
-- THE FIX
--   The same discipline start_estimate_trial already uses, with its own flag so
--   the exemption stays legible: a reward grant announces itself with
--   `app.plan_grant`, set transaction-locally around exactly one UPDATE and
--   lowered immediately after. set_config(..., true) cannot outlive the
--   statement's transaction, set_config lives in pg_catalog so PostgREST will
--   not expose it, and a client PostgREST call is one statement per
--   transaction -- so nothing but these two functions can raise it before an
--   UPDATE reaches the guard.
--
--   The guard keeps refusing every other client write, which is the whole point
--   of 20260819000001.
--
-- APPLY IT (self-hosted, on 103.233.65.233 — see SELF-HOSTING.md:276):
--
--   sudo -u postgres psql -d catalogshare -f 20260825000000_reward_grant_guard_exemption.sql
--
-- The last SELECT prints a row per object; every status must read OK.
-- Idempotent; safe to re-run.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Teach the guard about sanctioned reward/coupon grants
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_company_subscription_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The service role (edge functions) and platform admins bypass the guard.
  IF auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- ...and so does start_estimate_trial, the ONLY sanctioned way for a merchant
  -- to stamp trial_started_at.
  IF current_setting('app.trial_grant', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- ...and redeem_reward_offer / claim_full_coupon, which grant plan days that
  -- were paid for in points or with a 100%-off code rather than in rupees.
  -- Neither takes a plan id from the caller: redeem_reward_offer reads it from
  -- the offer row it just charged for, and claim_full_coupon checks the code,
  -- the validity window, the plan scope and both quotas before it gets here.
  -- The caller can only BE a company, never name one.
  IF current_setting('app.plan_grant', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan
     OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.trial_started_at IS DISTINCT FROM OLD.trial_started_at THEN
    RAISE EXCEPTION
      'Subscription, trial and ownership fields cannot be changed directly. Complete a payment instead.';
  END IF;

  RETURN NEW;
END;
$$;


-- -----------------------------------------------------------------------------
-- 2. redeem_reward_offer -- raise the flag around the one UPDATE it needs
--
-- Unchanged from 20260821000000 apart from the two set_config calls and the
-- plan-exists check below: the balance re-read, the company row lock that stops
-- a double tap spending twice, and the refusal to downgrade a live paid plan
-- all still live here and nowhere else.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_reward_offer(p_offer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o             public.reward_offers%ROWTYPE;
  v_company     public.companies%ROWTYPE;
  v_balance     INTEGER;
  v_from        TIMESTAMPTZ;
  v_until       TIMESTAMPTZ;
  v_redemption  UUID;
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

  -- The plan id comes from the offer, but the CHECK constraint on
  -- companies.subscription_plan is rebuilt from the plans table
  -- (20260821010000). An offer pointing at a plan id that was later renamed or
  -- removed would abort the UPDATE with a check_violation the merchant cannot
  -- act on, so refuse before charging anything and say something true instead.
  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE id = o.plan_id) THEN
    RETURN jsonb_build_object('ok', false,
      'reason', 'That reward points at a plan that no longer exists. Nothing was charged.');
  END IF;

  -- Never shorten what someone already paid for. A merchant on a live PAID plan
  -- redeeming a different plan would be a downgrade, so refuse and say why
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

  INSERT INTO public.reward_redemptions (company_id, offer_id, plan_id, days, points_spent, granted_until)
  VALUES (v_company.id, o.id, o.plan_id, o.days, o.points_cost, v_until)
  RETURNING id INTO v_redemption;

  INSERT INTO public.points_ledger (company_id, delta, reason, ref, note)
  VALUES (v_company.id, -o.points_cost, 'redemption', v_redemption::TEXT, o.label);

  -- Transaction-local, and lowered again immediately: the exemption covers this
  -- one UPDATE and nothing else that might run later in the same transaction.
  PERFORM set_config('app.plan_grant', 'on', true);

  UPDATE public.companies
     SET subscription_plan = o.plan_id,
         subscription_expires_at = v_until
   WHERE id = v_company.id;

  PERFORM set_config('app.plan_grant', 'off', true);

  RETURN jsonb_build_object('ok', true, 'plan', o.plan_id, 'days', o.days,
                            'until', v_until, 'spent', o.points_cost,
                            'balance', v_balance - o.points_cost);
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_reward_offer(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 3. claim_full_coupon -- same defect, same fix
--
-- Unchanged from 20260821000000 apart from the two set_config calls. Every
-- eligibility check stays in the database, because this hands out a plan with no
-- money involved and is the most attractive thing in the schema to attack.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_full_coupon(p_code TEXT, p_plan_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            public.coupons%ROWTYPE;
  v_company    public.companies%ROWTYPE;
  v_used       INTEGER;
  v_until      TIMESTAMPTZ;
  v_days       INTEGER := 30;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Not signed in.');
  END IF;

  -- FOR UPDATE serialises two taps of Redeem from the same account.
  SELECT * INTO v_company FROM public.companies
   WHERE owner_id = auth.uid() LIMIT 1 FOR UPDATE;
  IF v_company.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Set up your company first.');
  END IF;

  SELECT * INTO c FROM public.coupons
   WHERE upper(code) = upper(trim(p_code)) LIMIT 1 FOR UPDATE;

  IF c.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'That coupon code does not exist.');
  END IF;

  -- A coupon that is not actually 100% must go through the paid flow. Granting
  -- here on a partial discount would hand out a free plan for a 10% code.
  IF c.percent_off < 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This coupon needs a payment. Please continue to checkout.');
  END IF;

  IF NOT c.active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This coupon is no longer active.');
  END IF;
  IF c.starts_at IS NOT NULL AND now() < c.starts_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This coupon is not valid yet.');
  END IF;
  IF c.expires_at IS NOT NULL AND now() > c.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This coupon has expired.');
  END IF;
  IF c.max_redemptions IS NOT NULL AND c.redeemed_count >= c.max_redemptions THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This coupon has been fully claimed.');
  END IF;
  IF c.applies_to_plans IS NOT NULL AND NOT (p_plan_id = ANY (c.applies_to_plans)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'This coupon does not apply to that plan.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE id = p_plan_id AND price > 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'That plan cannot be claimed.');
  END IF;

  SELECT count(*) INTO v_used
    FROM public.coupon_redemptions
   WHERE coupon_id = c.id AND company_id = v_company.id;

  IF c.per_company_limit > 0 AND v_used >= c.per_company_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'You have already used this coupon.');
  END IF;

  -- Extend rather than overwrite, so claiming does not shorten time already
  -- paid for.
  v_until := GREATEST(COALESCE(v_company.subscription_expires_at, now()), now())
             + (v_days || ' days')::INTERVAL;

  PERFORM set_config('app.plan_grant', 'on', true);

  UPDATE public.companies
     SET subscription_plan = p_plan_id, subscription_expires_at = v_until
   WHERE id = v_company.id;

  PERFORM set_config('app.plan_grant', 'off', true);

  INSERT INTO public.coupon_redemptions
    (coupon_id, company_id, plan_id, percent_off, original_amount, final_amount, razorpay_order_id)
  SELECT c.id, v_company.id, p_plan_id, c.percent_off, pl.price * 100, 0, NULL
    FROM public.plans pl WHERE pl.id = p_plan_id;

  UPDATE public.coupons SET redeemed_count = redeemed_count + 1 WHERE id = c.id;

  RETURN jsonb_build_object('ok', true, 'plan', p_plan_id, 'days', v_days, 'until', v_until);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_full_coupon(TEXT, TEXT) TO authenticated;


-- =============================================================================
-- Verification -- every row must say OK
-- =============================================================================
SELECT 'guard knows app.plan_grant' AS object,
       CASE WHEN pg_get_functiondef(p.oid) LIKE '%app.plan_grant%'
            THEN 'OK' ELSE 'STILL BLOCKING REDEMPTIONS' END AS status
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'guard_company_subscription_columns'
UNION ALL
SELECT 'redeem_reward_offer raises it',
       CASE WHEN pg_get_functiondef(p.oid) LIKE '%app.plan_grant%'
            THEN 'OK' ELSE 'NOT PATCHED' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'redeem_reward_offer'
UNION ALL
SELECT 'claim_full_coupon raises it',
       CASE WHEN pg_get_functiondef(p.oid) LIKE '%app.plan_grant%'
            THEN 'OK' ELSE 'NOT PATCHED' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'claim_full_coupon'
UNION ALL
-- Every active offer must point at a plan that exists, or redeeming it now
-- returns a clean refusal instead of granting anything.
SELECT 'active offers point at real plans',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM public.reward_offers o
               WHERE o.active
                 AND NOT EXISTS (SELECT 1 FROM public.plans pl WHERE pl.id = o.plan_id))
            THEN 'OK' ELSE 'SOME OFFERS ARE UNREDEEMABLE' END;
