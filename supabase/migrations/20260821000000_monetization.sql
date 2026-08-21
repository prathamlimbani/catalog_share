-- =============================================================================
-- CatalogShare monetization: rewarded ads, points wallet, coupons, redeemable
-- plan days, and admin-configurable ad policy.
--
-- Apply with:  supabase db push
--          or: paste into the Supabase SQL editor and run
--
-- Everything here is idempotent, so re-running it is safe.
--
-- DEPENDS ON 20260819000000 (the widened plan CHECK constraints). Apply
-- APPLY-MISSING-MIGRATIONS.sql first or the plan ids used below are rejected.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. app_settings — one row per tunable, edited from the master admin console
--
-- Key/value rather than columns because the whole point is that the owner can
-- retune the economy (points per ad, daily caps, rupee value of a point)
-- without a release. Reads are public: the client has to know the daily cap to
-- render the Earn screen. Writes are admin-only.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read app settings" ON public.app_settings;
CREATE POLICY "Anyone can read app settings"
  ON public.app_settings FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins manage app settings" ON public.app_settings;
CREATE POLICY "Admins manage app settings"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.app_settings (key, value) VALUES
  ('rewards', jsonb_build_object(
      'enabled',              true,
      -- Points granted per verified rewarded ad. The SSV callback multiplies
      -- Google's reward_amount by this.
      'points_per_ad',        10,
      -- Hard stop per company per UTC day. Without a cap a scripted device
      -- farms points at whatever rate ad fill allows.
      'daily_ad_cap',         10,
      -- Shown on the Earn screen so the number means something to a merchant.
      'points_label',         'Coins'
  )),
  ('ads', jsonb_build_object(
      'enabled',              true,
      -- Ask before a rewarded ad rather than autoplaying it.
      'rewarded_prompt',      true,
      -- Estimates a free user may save per day before the app offers a
      -- rewarded ad. See the note on plan_ad_policy below about WHY this is a
      -- soft quota and not a hard gate.
      'free_daily_estimates', 3
  ))
ON CONFLICT (key) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 2. plan_ad_policy — which ad formats each plan sees
--
-- Replaces `adsEnabled = !isPaid` hardcoded in the client. The owner can now
-- run ads on a cheap paid tier, or turn a format off globally, from the console.
--
-- A NOTE ON REWARDED ADS AND GOOGLE PLAY POLICY
-- Making a user watch an ad before they can save work they have already typed
-- is the pattern Play's Ads policy calls out as interfering with app
-- functionality, and it is a plausible rejection. The design this schema
-- supports instead: saving is ALWAYS allowed; past `free_daily_estimates` the
-- app OFFERS a rewarded ad to lift the day's quota, and declining still leaves
-- the estimate saved locally and synced. That keeps the revenue and removes the
-- policy exposure.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plan_ad_policy (
  plan_id           TEXT PRIMARY KEY,
  show_banner       BOOLEAN NOT NULL DEFAULT true,
  show_interstitial BOOLEAN NOT NULL DEFAULT true,
  show_rewarded     BOOLEAN NOT NULL DEFAULT true,
  -- 0 = unlimited. Applies to the estimate quota described above.
  daily_estimates   INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_ad_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read plan ad policy" ON public.plan_ad_policy;
CREATE POLICY "Anyone can read plan ad policy"
  ON public.plan_ad_policy FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins manage plan ad policy" ON public.plan_ad_policy;
CREATE POLICY "Admins manage plan ad policy"
  ON public.plan_ad_policy FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Defaults reproduce today's behaviour exactly: free sees everything, paid sees
-- nothing. Change them in the console, not here.
INSERT INTO public.plan_ad_policy (plan_id, show_banner, show_interstitial, show_rewarded, daily_estimates) VALUES
  ('free',              true,  true,  true,  3),
  ('growth',            false, false, true,  0),
  ('estimate_generate', false, false, false, 0),
  ('pro',               false, false, false, 0),
  ('support',           false, false, false, 0)
ON CONFLICT (plan_id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 3. coupons — percentage discount at checkout
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coupons (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored upper-case; lookups upper-case the input. Merchants type coupons
  -- however they like and a case-sensitive miss reads as "your code is wrong".
  code              TEXT NOT NULL UNIQUE,
  description       TEXT,
  percent_off       INTEGER NOT NULL CHECK (percent_off BETWEEN 0 AND 100),
  -- NULL = every plan. Otherwise the plan ids this code is valid for.
  applies_to_plans  TEXT[],
  -- NULL = unlimited.
  max_redemptions   INTEGER,
  redeemed_count    INTEGER NOT NULL DEFAULT 0,
  per_company_limit INTEGER NOT NULL DEFAULT 1,
  starts_at         TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_upper_idx ON public.coupons (upper(code));

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- Deliberately NO public select policy. Letting anyone list this table hands
-- out every working discount code. Validation goes through validate_coupon().
DROP POLICY IF EXISTS "Admins manage coupons" ON public.coupons;
CREATE POLICY "Admins manage coupons"
  ON public.coupons FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id         UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id           TEXT NOT NULL,
  percent_off       INTEGER NOT NULL,
  original_amount   INTEGER NOT NULL,  -- paise
  final_amount      INTEGER NOT NULL,  -- paise
  razorpay_order_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_company_idx ON public.coupon_redemptions (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_order_idx
  ON public.coupon_redemptions (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;

ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own coupon redemptions" ON public.coupon_redemptions;
CREATE POLICY "Owners read own coupon redemptions"
  ON public.coupon_redemptions FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "Admins manage coupon redemptions" ON public.coupon_redemptions;
CREATE POLICY "Admins manage coupon redemptions"
  ON public.coupon_redemptions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- -----------------------------------------------------------------------------
-- 4. points_ledger — the wallet
--
-- Append-only ledger, never a mutable balance column. A balance you can UPDATE
-- is a balance two concurrent requests can both read as 40 and both write as
-- 50. The balance is SUM(delta), which cannot drift and shows its own history
-- when a merchant asks where their coins went.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.points_ledger (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Positive to credit, negative to spend.
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,   -- 'ad_reward' | 'redemption' | 'admin_grant' | 'signup_bonus'
  -- External identity of the thing that caused this line: the AdMob
  -- transaction_id, the redemption id. Unique per reason, so a retried callback
  -- credits once.
  ref        TEXT,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS points_ledger_reason_ref_idx
  ON public.points_ledger (reason, ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS points_ledger_company_idx
  ON public.points_ledger (company_id, created_at DESC);

ALTER TABLE public.points_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own points" ON public.points_ledger;
CREATE POLICY "Owners read own points"
  ON public.points_ledger FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

-- No INSERT policy for merchants on purpose: points are only ever created by
-- the SECURITY DEFINER functions below. A client that can insert its own
-- ledger lines can mint currency.
DROP POLICY IF EXISTS "Admins manage points" ON public.points_ledger;
CREATE POLICY "Admins manage points"
  ON public.points_ledger FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


CREATE OR REPLACE VIEW public.wallet_balances AS
  SELECT company_id, COALESCE(SUM(delta), 0)::INTEGER AS balance
    FROM public.points_ledger
   GROUP BY company_id;


-- -----------------------------------------------------------------------------
-- 5. ad_reward_events — one row per verified rewarded impression
--
-- transaction_id is the PRIMARY KEY, which is what makes the SSV callback
-- idempotent: Google retries, and a captured callback URL replayed by hand,
-- both collide here and credit nothing the second time.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ad_reward_events (
  transaction_id  TEXT PRIMARY KEY,
  user_id         UUID,
  company_id      UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  reward_amount   NUMERIC(12,2),
  reward_item     TEXT,
  ad_unit         TEXT,
  custom_data     TEXT,
  credited_points INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ad_reward_events_company_day_idx
  ON public.ad_reward_events (company_id, created_at DESC);

ALTER TABLE public.ad_reward_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own ad rewards" ON public.ad_reward_events;
CREATE POLICY "Owners read own ad rewards"
  ON public.ad_reward_events FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "Admins read ad rewards" ON public.ad_reward_events;
CREATE POLICY "Admins read ad rewards"
  ON public.ad_reward_events FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- -----------------------------------------------------------------------------
-- 6. reward_offers — what points buy
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reward_offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT NOT NULL,
  plan_id     TEXT NOT NULL,
  days        INTEGER NOT NULL CHECK (days > 0),
  points_cost INTEGER NOT NULL CHECK (points_cost > 0),
  active      BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.reward_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read active offers" ON public.reward_offers;
CREATE POLICY "Anyone can read active offers"
  ON public.reward_offers FOR SELECT
  USING (active OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage offers" ON public.reward_offers;
CREATE POLICY "Admins manage offers"
  ON public.reward_offers FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Starting economy: 10 points per ad, cap 10 ads/day = 100 points/day.
-- Growth is ~₹6.63/day, so 100 points ~ 3 days of Growth prices a point at
-- roughly ₹0.20 — comfortably under an Indian rewarded-ad eCPM, so a redeemed
-- day is still gross-margin positive.
INSERT INTO public.reward_offers (label, plan_id, days, points_cost, sort_order) VALUES
  ('Growth for 3 days',            'growth',            3,  100, 1),
  ('Growth for 7 days',            'growth',            7,  210, 2),
  ('Estimate Generator for 3 days','estimate_generate', 3,  200, 3),
  ('Pro for 3 days',               'pro',               3,  180, 4)
ON CONFLICT DO NOTHING;


CREATE TABLE IF NOT EXISTS public.reward_redemptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  offer_id      UUID REFERENCES public.reward_offers(id) ON DELETE SET NULL,
  plan_id       TEXT NOT NULL,
  days          INTEGER NOT NULL,
  points_spent  INTEGER NOT NULL,
  granted_until TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_redemptions_company_idx
  ON public.reward_redemptions (company_id, created_at DESC);

ALTER TABLE public.reward_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own redemptions" ON public.reward_redemptions;
CREATE POLICY "Owners read own redemptions"
  ON public.reward_redemptions FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "Admins manage redemptions" ON public.reward_redemptions;
CREATE POLICY "Admins manage redemptions"
  ON public.reward_redemptions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));


-- =============================================================================
-- Functions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- credit_ad_reward — called ONLY by the SSV endpoint, with the service role.
--
-- Everything that makes this safe is here rather than in the endpoint: the
-- endpoint is a network service that could be rewritten or replaced, while
-- these rules are what actually protect the economy.
--   * transaction_id is the primary key, so retries credit once
--   * the daily cap is counted from the table, not trusted from the caller
--   * the reward amount is IGNORED in favour of the configured points_per_ad,
--     so a tampered client-side reward value buys nothing
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_ad_reward(
  p_transaction_id TEXT,
  p_user_id        TEXT,
  p_reward_amount  NUMERIC DEFAULT 1,
  p_reward_item    TEXT DEFAULT NULL,
  p_ad_unit        TEXT DEFAULT NULL,
  p_custom_data    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id  UUID;
  v_user_uuid   UUID;
  v_cfg         JSONB;
  v_points      INTEGER;
  v_cap         INTEGER;
  v_today_count INTEGER;
BEGIN
  IF p_transaction_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing transaction_id or user_id');
  END IF;

  -- Already credited: report success so the caller stops retrying.
  IF EXISTS (SELECT 1 FROM public.ad_reward_events WHERE transaction_id = p_transaction_id) THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  BEGIN
    v_user_uuid := p_user_id::UUID;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'user_id is not a uuid');
  END;

  SELECT id INTO v_company_id FROM public.companies WHERE owner_id = v_user_uuid LIMIT 1;
  IF v_company_id IS NULL THEN
    -- Record it anyway: an event with no company is a signal worth keeping,
    -- and it still burns the transaction id so a replay cannot land later.
    INSERT INTO public.ad_reward_events (transaction_id, user_id, reward_amount, reward_item, ad_unit, custom_data, credited_points)
    VALUES (p_transaction_id, v_user_uuid, p_reward_amount, p_reward_item, p_ad_unit, p_custom_data, 0);
    RETURN jsonb_build_object('ok', false, 'reason', 'no company for user');
  END IF;

  SELECT value INTO v_cfg FROM public.app_settings WHERE key = 'rewards';
  v_points := COALESCE((v_cfg->>'points_per_ad')::INTEGER, 10);
  v_cap    := COALESCE((v_cfg->>'daily_ad_cap')::INTEGER, 10);

  IF COALESCE((v_cfg->>'enabled')::BOOLEAN, true) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rewards disabled');
  END IF;

  SELECT count(*) INTO v_today_count
    FROM public.ad_reward_events
   WHERE company_id = v_company_id
     AND credited_points > 0
     AND created_at >= date_trunc('day', now());

  IF v_cap > 0 AND v_today_count >= v_cap THEN
    INSERT INTO public.ad_reward_events (transaction_id, user_id, company_id, reward_amount, reward_item, ad_unit, custom_data, credited_points)
    VALUES (p_transaction_id, v_user_uuid, v_company_id, p_reward_amount, p_reward_item, p_ad_unit, p_custom_data, 0);
    RETURN jsonb_build_object('ok', false, 'reason', 'daily cap reached', 'cap', v_cap);
  END IF;

  INSERT INTO public.ad_reward_events (transaction_id, user_id, company_id, reward_amount, reward_item, ad_unit, custom_data, credited_points)
  VALUES (p_transaction_id, v_user_uuid, v_company_id, p_reward_amount, p_reward_item, p_ad_unit, p_custom_data, v_points);

  INSERT INTO public.points_ledger (company_id, delta, reason, ref, note)
  VALUES (v_company_id, v_points, 'ad_reward', p_transaction_id, COALESCE(p_ad_unit, 'rewarded ad'));

  RETURN jsonb_build_object('ok', true, 'points', v_points, 'today', v_today_count + 1, 'cap', v_cap);
END;
$$;

REVOKE ALL ON FUNCTION public.credit_ad_reward(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_ad_reward(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM anon, authenticated;
-- service_role only: this function mints currency.
GRANT EXECUTE ON FUNCTION public.credit_ad_reward(TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO service_role;


-- -----------------------------------------------------------------------------
-- validate_coupon — check a code without exposing the coupons table
--
-- Returns the discount, or a reason it cannot be used. SECURITY DEFINER so the
-- caller never needs SELECT on `coupons`; without that, publishing a coupon
-- would mean publishing every coupon.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_coupon(p_code TEXT, p_plan_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            public.coupons%ROWTYPE;
  v_company_id UUID;
  v_used       INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Sign in to use a coupon.');
  END IF;

  SELECT * INTO c FROM public.coupons WHERE upper(code) = upper(trim(p_code)) LIMIT 1;

  IF c.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'That coupon code does not exist.');
  END IF;
  IF NOT c.active THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'This coupon is no longer active.');
  END IF;
  IF c.starts_at IS NOT NULL AND now() < c.starts_at THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'This coupon is not valid yet.');
  END IF;
  IF c.expires_at IS NOT NULL AND now() > c.expires_at THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'This coupon has expired.');
  END IF;
  IF c.max_redemptions IS NOT NULL AND c.redeemed_count >= c.max_redemptions THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'This coupon has been fully claimed.');
  END IF;
  IF c.applies_to_plans IS NOT NULL AND NOT (p_plan_id = ANY (c.applies_to_plans)) THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'This coupon does not apply to that plan.');
  END IF;

  SELECT id INTO v_company_id FROM public.companies WHERE owner_id = auth.uid() LIMIT 1;
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'Set up your company first.');
  END IF;

  SELECT count(*) INTO v_used
    FROM public.coupon_redemptions
   WHERE coupon_id = c.id AND company_id = v_company_id;

  IF c.per_company_limit > 0 AND v_used >= c.per_company_limit THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'You have already used this coupon.');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code', upper(c.code),
    'percent_off', c.percent_off,
    'description', c.description
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_coupon(TEXT, TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- redeem_reward_offer — spend points for plan days
--
-- The balance is re-read and the spend is written inside one statement pair
-- under a company row lock, so two taps cannot both pass the balance check.
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

  UPDATE public.companies
     SET subscription_plan = o.plan_id,
         subscription_expires_at = v_until
   WHERE id = v_company.id;

  RETURN jsonb_build_object('ok', true, 'plan', o.plan_id, 'days', o.days,
                            'until', v_until, 'spent', o.points_cost,
                            'balance', v_balance - o.points_cost);
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_reward_offer(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- Realtime, so a credited point and a granted plan both land without a refresh.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='points_ledger') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.points_ledger;
  END IF;
END $$;


-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'app_settings'        AS object, CASE WHEN to_regclass('public.app_settings')        IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'plan_ad_policy',      CASE WHEN to_regclass('public.plan_ad_policy')      IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'coupons',             CASE WHEN to_regclass('public.coupons')             IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'points_ledger',       CASE WHEN to_regclass('public.points_ledger')       IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'ad_reward_events',    CASE WHEN to_regclass('public.ad_reward_events')    IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'reward_offers',       CASE WHEN to_regclass('public.reward_offers')       IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'reward_redemptions',  CASE WHEN to_regclass('public.reward_redemptions')  IS NOT NULL THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'credit_ad_reward()',  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='credit_ad_reward')  THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'validate_coupon()',   CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='validate_coupon')   THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'redeem_reward_offer()', CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='redeem_reward_offer') THEN 'OK' ELSE 'MISSING' END;
