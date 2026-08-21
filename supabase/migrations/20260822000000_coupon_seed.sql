-- =============================================================================
-- The launch coupon set.
--
-- Every code here is ONE PER MERCHANT (per_company_limit = 1) and every code is
-- limited in total (max_redemptions), because an unlimited 100%-off code is an
-- unlimited free plan the moment it is screenshotted into a WhatsApp group.
--
-- Two families:
--   * YOUR<PLAN>  - 100% off, one free month of that specific plan. These do NOT
--                   go through Razorpay: an order under one rupee cannot be
--                   created, so claim_full_coupon grants them directly.
--   * everything else - a percentage off any plan.
--
-- Apply with:  supabase db push
--          or: paste into the Supabase SQL editor and run
--
-- DEPENDS ON 20260821000000_monetization.sql (the coupons table).
-- Idempotent: ON CONFLICT keeps whatever you have since edited in the console.
-- =============================================================================

INSERT INTO public.coupons
  (code, description, percent_off, applies_to_plans, max_redemptions, per_company_limit, expires_at, active)
VALUES
  -- ---------------------------------------------------------------------
  -- Free month, one plan each. The name says what you get.
  -- ---------------------------------------------------------------------
  ('YOURCATALOG',  'One month of Growth, free',              100, ARRAY['growth'],            200, 1, now() + INTERVAL '90 days',  true),
  ('YOURESTIMATE', 'One month of Estimate Generator, free',  100, ARRAY['estimate_generate'], 100, 1, now() + INTERVAL '90 days',  true),
  ('YOURPRO',      'One month of Pro, free',                 100, ARRAY['pro'],                50, 1, now() + INTERVAL '90 days',  true),
  ('YOURSUPPORT',  'One month of Monthly Support, free',     100, ARRAY['support'],            25, 1, now() + INTERVAL '90 days',  true),

  -- ---------------------------------------------------------------------
  -- Percentage off, valid on every paid plan (applies_to_plans NULL = all).
  -- ---------------------------------------------------------------------
  ('WELCOME50',    'Half off your first month',               50, NULL,  500, 1, now() + INTERVAL '180 days', true),
  ('FIRSTSHOP',    'For a merchant''s first paid plan',        40, NULL,  500, 1, now() + INTERVAL '180 days', true),
  ('NEWSHOP30',    '30% off any plan',                        30, NULL, 1000, 1, now() + INTERVAL '180 days', true),
  ('CATALOG25',    '25% off any plan',                        25, NULL, 1000, 1, NULL,                        true),
  ('WHOLESALE20',  '20% off any plan',                        20, NULL, 1000, 1, NULL,                        true),

  -- ---------------------------------------------------------------------
  -- Seasonal. Short windows on purpose - a festival code that still works in
  -- March is just a permanent discount with a confusing name.
  -- ---------------------------------------------------------------------
  ('DIWALI50',     'Diwali offer - half off',                 50, NULL,  500, 1, now() + INTERVAL '60 days',  true),
  ('GSTREADY',     'For merchants going GST-ready',            35, ARRAY['estimate_generate','pro','support'], 300, 1, now() + INTERVAL '120 days', true)
ON CONFLICT (code) DO NOTHING;


-- =============================================================================
-- Verification - shows exactly what a merchant can type today
-- =============================================================================
SELECT
  code,
  percent_off || '%'                                            AS discount,
  COALESCE(array_to_string(applies_to_plans, ', '), 'all plans') AS valid_on,
  per_company_limit                                             AS per_merchant,
  COALESCE(max_redemptions::TEXT, 'unlimited')                  AS total,
  redeemed_count                                                AS used,
  COALESCE(to_char(expires_at, 'DD Mon YYYY'), 'no expiry')      AS expires
FROM public.coupons
WHERE active
ORDER BY percent_off DESC, code;
