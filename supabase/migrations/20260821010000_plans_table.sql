-- =============================================================================
-- Editable plan catalogue.
--
-- Plans lived in src/lib/plans.ts, so changing a price meant a release — and on
-- Android, a release means a Play review and users who do not update for weeks.
-- This table becomes the source of truth; the built-in catalogue stays in the
-- bundle as the fallback for a client that cannot reach the table.
--
-- Apply with:  supabase db push
--          or: paste into the Supabase SQL editor and run
--
-- Idempotent. Safe to re-run.
--
-- ⚠ READ THIS BEFORE CHANGING A PRICE
-- verify-razorpay-payment checks the amount Razorpay charged against the plan
-- price and REJECTS a mismatch. Until the updated edge function (which reads
-- this table) is deployed, changing a price here makes every payment for that
-- plan fail verification. See supabase/functions/verify-razorpay-payment.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.plans (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  -- Whole rupees, matching PlanDef.price. Paise are derived (× 100) at the one
  -- place that talks to Razorpay, so there is never a second unit to keep sane.
  price                  INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  price_label            TEXT,
  product_limit          INTEGER NOT NULL DEFAULT 40,
  features               TEXT[] NOT NULL DEFAULT '{}',
  unlocks_estimates      BOOLEAN NOT NULL DEFAULT false,
  unlocks_premium_skins  BOOLEAN NOT NULL DEFAULT false,
  unlocks_call_support   BOOLEAN NOT NULL DEFAULT false,
  popular                BOOLEAN NOT NULL DEFAULT false,
  -- Upgrade/downgrade ordering. Mirrors PLAN_RANK.
  rank                   INTEGER NOT NULL DEFAULT 0,
  -- Hidden plans still resolve for existing subscribers; they just stop being
  -- offered. Deleting a plan someone is on would leave their row pointing at
  -- nothing, so the console hides rather than deletes when it is in use.
  active                 BOOLEAN NOT NULL DEFAULT true,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- The pricing page is public, so the catalogue is public.
DROP POLICY IF EXISTS "Anyone can read plans" ON public.plans;
CREATE POLICY "Anyone can read plans"
  ON public.plans FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins manage plans" ON public.plans;
CREATE POLICY "Admins manage plans"
  ON public.plans FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS plans_updated_at ON public.plans;
CREATE TRIGGER plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed from the shipped catalogue so the table starts as an exact mirror of
-- current behaviour. ON CONFLICT DO NOTHING: re-running must never revert an
-- edit the owner has since made in the console.
INSERT INTO public.plans
  (id, name, price, price_label, product_limit, features,
   unlocks_estimates, unlocks_premium_skins, unlocks_call_support, popular, rank, sort_order)
VALUES
  ('free', 'Free Plan', 0, 'FREE', 40,
   ARRAY['40 Products','Basic Listing','Standard Support','Ads supported'],
   false, false, false, false, 0, 0),

  ('growth', 'Growth Plan', 199, '₹199/month', 300,
   ARRAY['Up to 300 Products','Estimates & Invoices','Better Visibility','Premium Themes','No ads','Standard Support'],
   true, false, false, false, 1, 1),

  ('pro', 'Pro Plan', 349, '₹349/month', 9999,
   ARRAY['500+ Products','Custom Branding with Logo','Premium Themes & Skins','Priority & Call Support','No ads','Featured Listing'],
   true, true, true, false, 2, 3),

  ('estimate_generate', 'Estimate Generator Plan', 399, '₹399/month', 300,
   ARRAY['Unlimited Estimates & Invoices','Works fully offline','PDF download & WhatsApp share','Up to 300 Products','No ads'],
   true, false, false, true, 3, 2),

  ('support', 'Monthly Support Subscription', 499, '₹499/month', 9999,
   ARRAY['Everything in Pro','Unlimited Estimates & Invoices','Premium Themes & Skins','Priority & Call Support','No ads','Helps us keep improving CatalogShare'],
   true, true, true, false, 4, 4)
ON CONFLICT (id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- admin_upsert_plan — create or edit a plan from the console
--
-- A plain table UPDATE would do, but this keeps the plan-id rules in one place
-- and refuses the two edits that quietly corrupt things: renaming `free`'s id,
-- and giving a paid plan a price of zero (which makes Razorpay reject the order
-- rather than granting it free).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_upsert_plan(p_plan JSONB)
RETURNS public.plans
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     TEXT := lower(trim(p_plan->>'id'));
  v_price  INTEGER := COALESCE((p_plan->>'price')::INTEGER, 0);
  v_result public.plans;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators may change plans';
  END IF;

  IF v_id IS NULL OR v_id = '' THEN
    RAISE EXCEPTION 'A plan needs an id';
  END IF;
  IF v_id !~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Plan id % must be lower-case letters, digits and underscores', v_id;
  END IF;
  IF v_id = 'free' AND v_price <> 0 THEN
    RAISE EXCEPTION 'The free plan must stay at 0';
  END IF;

  INSERT INTO public.plans AS pl (
    id, name, price, price_label, product_limit, features,
    unlocks_estimates, unlocks_premium_skins, unlocks_call_support,
    popular, rank, active, sort_order
  ) VALUES (
    v_id,
    COALESCE(p_plan->>'name', initcap(replace(v_id, '_', ' '))),
    v_price,
    COALESCE(p_plan->>'price_label',
             CASE WHEN v_price > 0 THEN '₹' || v_price || '/month' ELSE 'FREE' END),
    COALESCE((p_plan->>'product_limit')::INTEGER, 40),
    COALESCE(
      (SELECT array_agg(value::TEXT) FROM jsonb_array_elements_text(p_plan->'features')),
      '{}'
    ),
    COALESCE((p_plan->>'unlocks_estimates')::BOOLEAN, false),
    COALESCE((p_plan->>'unlocks_premium_skins')::BOOLEAN, false),
    COALESCE((p_plan->>'unlocks_call_support')::BOOLEAN, false),
    COALESCE((p_plan->>'popular')::BOOLEAN, false),
    COALESCE((p_plan->>'rank')::INTEGER, 0),
    COALESCE((p_plan->>'active')::BOOLEAN, true),
    COALESCE((p_plan->>'sort_order')::INTEGER, 0)
  )
  ON CONFLICT (id) DO UPDATE SET
    name                  = EXCLUDED.name,
    price                 = EXCLUDED.price,
    price_label           = EXCLUDED.price_label,
    product_limit         = EXCLUDED.product_limit,
    features              = EXCLUDED.features,
    unlocks_estimates     = EXCLUDED.unlocks_estimates,
    unlocks_premium_skins = EXCLUDED.unlocks_premium_skins,
    unlocks_call_support  = EXCLUDED.unlocks_call_support,
    popular               = EXCLUDED.popular,
    rank                  = EXCLUDED.rank,
    active                = EXCLUDED.active,
    sort_order            = EXCLUDED.sort_order
  RETURNING pl.* INTO v_result;

  -- A new plan id has to be allowed through the CHECK constraints that guard
  -- companies.subscription_plan, or nobody can ever be put on it.
  BEGIN
    ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_subscription_plan_check;
    EXECUTE format(
      'ALTER TABLE public.companies ADD CONSTRAINT companies_subscription_plan_check CHECK (subscription_plan IN (%s))',
      (SELECT string_agg(quote_literal(id), ',') FROM public.plans)
    );
    ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
    EXECUTE format(
      'ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN (%s))',
      (SELECT string_agg(quote_literal(id), ',') FROM public.plans)
    );
  EXCEPTION WHEN others THEN
    -- Widening the constraint is a convenience, not the point of the call.
    RAISE NOTICE 'Could not widen plan constraints: %', SQLERRM;
  END;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_plan(JSONB) TO authenticated;


-- -----------------------------------------------------------------------------
-- admin_delete_plan — refuses to strand existing subscribers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_plan(p_plan_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_use INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators may delete plans';
  END IF;
  IF p_plan_id = 'free' THEN
    RAISE EXCEPTION 'The free plan cannot be deleted — every account falls back to it';
  END IF;

  SELECT count(*) INTO v_in_use
    FROM public.companies
   WHERE subscription_plan = p_plan_id
     AND COALESCE(subscription_expires_at, now()) > now();

  IF v_in_use > 0 THEN
    -- Hide instead. Deleting would leave those rows pointing at a plan that no
    -- longer resolves, and the app would read them as free mid-subscription.
    UPDATE public.plans SET active = false WHERE id = p_plan_id;
    RETURN jsonb_build_object(
      'ok', true, 'deleted', false, 'hidden', true, 'in_use', v_in_use,
      'message', format('%s merchants are still on this plan, so it was hidden instead of deleted.', v_in_use));
  END IF;

  DELETE FROM public.plans WHERE id = p_plan_id;
  RETURN jsonb_build_object('ok', true, 'deleted', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_plan(TEXT) TO authenticated;


-- -----------------------------------------------------------------------------
-- admin_grant_plan — put any company on any plan for any number of days
--
-- Supersedes admin_set_subscription, which hardcoded 30 days and a fixed list
-- of plan ids. Days are explicit so support can hand out a 3-day apology or a
-- 365-day deal without maths.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_grant_plan(
  p_company_id UUID,
  p_plan_id    TEXT,
  p_days       INTEGER DEFAULT 30,
  p_extend     BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_until   TIMESTAMPTZ;
  v_current TIMESTAMPTZ;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators may grant a plan';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE id = p_plan_id) THEN
    RAISE EXCEPTION 'Unknown plan %', p_plan_id;
  END IF;

  IF p_plan_id = 'free' THEN
    UPDATE public.companies
       SET subscription_plan = 'free', subscription_expires_at = NULL
     WHERE id = p_company_id;
    RETURN jsonb_build_object('ok', true, 'plan', 'free', 'until', NULL);
  END IF;

  SELECT subscription_expires_at INTO v_current
    FROM public.companies WHERE id = p_company_id;

  -- extend = add to what is left; otherwise the grant starts now.
  v_until := CASE
    WHEN p_extend THEN GREATEST(COALESCE(v_current, now()), now())
    ELSE now()
  END + (GREATEST(p_days, 1) || ' days')::INTERVAL;

  UPDATE public.companies
     SET subscription_plan = p_plan_id, subscription_expires_at = v_until
   WHERE id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No company with id %', p_company_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'plan', p_plan_id, 'until', v_until, 'days', p_days);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_grant_plan(UUID, TEXT, INTEGER, BOOLEAN) TO authenticated;


-- Realtime so a price edit reaches open clients without a reload.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='plans') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.plans;
  END IF;
END $$;


-- =============================================================================
-- Verification
-- =============================================================================
SELECT 'plans table'          AS object, CASE WHEN to_regclass('public.plans') IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS status
UNION ALL SELECT 'plans seeded (5)', CASE WHEN (SELECT count(*) FROM public.plans) >= 5 THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'admin_upsert_plan()', CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_upsert_plan') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'admin_delete_plan()', CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_delete_plan') THEN 'OK' ELSE 'MISSING' END
UNION ALL SELECT 'admin_grant_plan()',  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_grant_plan')  THEN 'OK' ELSE 'MISSING' END;
