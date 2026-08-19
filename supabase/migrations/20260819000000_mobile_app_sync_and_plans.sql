-- =============================================================================
-- CatalogShare mobile app — offline sync, real plan ids, and RLS hardening
--
-- Apply with:  supabase db push
--          or: paste into the Supabase SQL editor and run
--
-- Everything here is idempotent, so re-running it is safe.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. invoices.updated_at — the sync cursor
--
-- The mobile app pulls only rows changed since its last successful sync. Without
-- this column every launch has to download the merchant's entire estimate
-- history, which on a metered Indian mobile connection is both slow and costly.
-- -----------------------------------------------------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS update_invoices_updated_at ON public.invoices;
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill so the first incremental pull does not skip pre-existing rows.
UPDATE public.invoices SET updated_at = created_at WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS invoices_company_updated_idx
  ON public.invoices (company_id, updated_at);


-- -----------------------------------------------------------------------------
-- 2. products index
--
-- Every product query in the app filters on company_id, and there was no index
-- on it — each storefront view was a sequential scan of the whole table.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS products_company_id_idx
  ON public.products (company_id);


-- -----------------------------------------------------------------------------
-- 3. companies.trial_started_at — server-owned trial clock
--
-- The 5-day estimate trial lived in localStorage keyed by company id, so
-- "clear site data" (or a reinstall) reset it and the trial was effectively
-- unlimited. Recording the start server-side makes it honest. The client keeps a
-- cached copy only so the countdown renders offline.
-- -----------------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;

-- Starts the trial exactly once. SECURITY DEFINER so the client cannot clear it
-- by writing the column directly, and the owner check keeps it self-service.
CREATE OR REPLACE FUNCTION public.start_estimate_trial(p_company_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies
    WHERE id = p_company_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorised for this company';
  END IF;

  SELECT trial_started_at INTO v_started
  FROM public.companies
  WHERE id = p_company_id;

  -- COALESCE means a second call is a no-op rather than a reset.
  IF v_started IS NULL THEN
    UPDATE public.companies
      SET trial_started_at = now()
      WHERE id = p_company_id
      RETURNING trial_started_at INTO v_started;
  END IF;

  RETURN v_started;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_estimate_trial(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 4. Real plan ids
--
-- The CHECK constraints only allowed ('free','growth','pro'), so the ₹399
-- estimate_generate and ₹499 support SKUs were being laundered into 'growth' and
-- 'pro' before every write. The consequences were not cosmetic: the database
-- could not distinguish a ₹199 Growth customer from a ₹399 Estimate customer,
-- admin emails told paying customers they were on the "Free Plan", and the
-- master admin's plan counters silently failed to sum.
-- -----------------------------------------------------------------------------
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_subscription_plan_check;
ALTER TABLE public.companies
  ADD CONSTRAINT companies_subscription_plan_check
  CHECK (subscription_plan IN ('free', 'growth', 'pro', 'estimate_generate', 'support'));

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('free', 'growth', 'pro', 'estimate_generate', 'support'));

-- Recover the real SKU for historical rows from the amount that was charged.
-- Amounts are stored in paise. 19900 = ₹199 growth, 34900 = ₹349 pro,
-- 39900 = ₹399 estimate_generate, 49900 = ₹499 support.
UPDATE public.subscriptions SET plan = 'estimate_generate'
  WHERE amount = 39900 AND plan <> 'estimate_generate';
UPDATE public.subscriptions SET plan = 'support'
  WHERE amount = 49900 AND plan <> 'support';

-- Propagate the corrected plan to the company row for anyone whose subscription
-- is still active.
UPDATE public.companies c
   SET subscription_plan = s.plan
  FROM (
    SELECT DISTINCT ON (company_id) company_id, plan, expires_at
      FROM public.subscriptions
     WHERE status = 'active'
     ORDER BY company_id, created_at DESC
  ) s
 WHERE c.id = s.company_id
   AND s.expires_at > now()
   AND s.plan IN ('estimate_generate', 'support')
   AND c.subscription_plan <> s.plan;

-- The admin RPC hard-rejected anything outside free/growth/pro, so support staff
-- could neither grant nor restore the two newest plans.
CREATE OR REPLACE FUNCTION public.admin_set_subscription(target_company_id UUID, new_plan TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators may change a subscription';
  END IF;

  IF new_plan NOT IN ('free', 'growth', 'pro', 'estimate_generate', 'support') THEN
    RAISE EXCEPTION 'Invalid plan %. Must be free, growth, pro, estimate_generate or support.', new_plan;
  END IF;

  UPDATE public.companies
     SET subscription_plan = new_plan,
         subscription_expires_at = CASE
           WHEN new_plan = 'free' THEN NULL
           ELSE GREATEST(COALESCE(subscription_expires_at, now()), now()) + INTERVAL '30 days'
         END
   WHERE id = target_company_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- 5. Atomic estimate numbering
--
-- Offline devices mint numbers like INV-K3F-0007; when they sync, a collision on
-- the UNIQUE (company_id, invoice_number) index has to be resolved by taking a
-- fresh number. Doing that with SELECT max()+1 races between two devices, so it
-- is done here under a row lock instead.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_company_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.companies
    WHERE id = p_company_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorised for this company';
  END IF;

  -- Lock the company row so two concurrent callers serialise here.
  PERFORM 1 FROM public.companies WHERE id = p_company_id FOR UPDATE;

  SELECT COALESCE(MAX((regexp_match(invoice_number, '(\d+)\s*$'))[1]::INTEGER), 0) + 1
    INTO v_next
    FROM public.invoices
   WHERE company_id = p_company_id;

  RETURN 'INV-' || LPAD(v_next::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_number(UUID) TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. RLS hardening
--
-- The invoices UPDATE policy had a USING clause but no WITH CHECK, so a client
-- could take one of its own invoices and re-point company_id at another company.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Company owners can update own invoices" ON public.invoices;
CREATE POLICY "Company owners can update own invoices"
  ON public.invoices FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()));


-- -----------------------------------------------------------------------------
-- 7. Drop the password_reset_otps table
--
-- Its SELECT policy was `USING (true)` for anon, i.e. anybody could read every
-- reset code in the table — a straightforward account-takeover primitive. The
-- app does not use it: password reset goes through GoTrue's own recovery OTP.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.password_reset_otps CASCADE;
