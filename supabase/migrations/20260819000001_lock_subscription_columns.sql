-- =============================================================================
-- Lock the subscription columns against client writes
--
--   *** APPLY THIS ONE LAST. ORDER MATTERS. ***
--
-- This migration makes the `verify-razorpay-payment` edge function the ONLY
-- thing that can grant a paid plan. Until now the browser did it directly:
-- Razorpay's signature was discarded, no order was created, the amount was
-- computed client-side, and the plan was granted with a plain
--   UPDATE companies SET subscription_plan = 'pro'
-- which anyone could issue from a console.
--
-- Because the app falls back to that client write when the edge function is
-- unreachable, applying this BEFORE the function is deployed would break real
-- payments: the charge would go through and the plan would not activate.
--
-- Correct order:
--   1. supabase functions deploy create-razorpay-order
--   2. supabase functions deploy verify-razorpay-payment
--   3. set the RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET function secrets
--   4. make one real test payment and confirm the plan activates
--   5. THEN run this migration
--
-- To roll back:  DROP TRIGGER guard_company_subscription_columns ON public.companies;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 7. Stop the client from granting itself a paid plan
--
-- "Owners can update their company" allowed a PATCH on ANY column, including
-- subscription_plan and subscription_expires_at — one PostgREST call from the
-- browser console was enough to self-grant Pro forever. Payment activation now
-- happens exclusively in the verify-razorpay-payment edge function using the
-- service-role key, so the client never needs to write these columns.
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

  -- ...and so does start_estimate_trial, which is the ONLY sanctioned way for a
  -- merchant to stamp trial_started_at.
  --
  -- auth.role() reads the request.jwt GUC, and SECURITY DEFINER changes the
  -- executing ROLE, not that GUC — inside start_estimate_trial the caller is
  -- still 'authenticated', so the check above did not exempt it and the trigger
  -- raised on its UPDATE. The trial could therefore never be recorded
  -- server-side. The function announces itself with a transaction-local flag
  -- instead; `set_config(..., true)` means it cannot outlive the statement's
  -- transaction, and no role but that function can set it before an UPDATE
  -- lands here (a client PostgREST call is one statement per transaction).
  IF current_setting('app.trial_grant', true) = 'on' THEN
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

DROP TRIGGER IF EXISTS guard_company_subscription_columns ON public.companies;
CREATE TRIGGER guard_company_subscription_columns
  BEFORE UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_company_subscription_columns();


-- -----------------------------------------------------------------------------
-- 8. Teach start_estimate_trial to raise the flag the guard now looks for
--
-- Replaced here rather than edited in 20260819000000 so a database that has
-- already run that migration picks the change up.
-- -----------------------------------------------------------------------------
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

  -- A second call is a no-op rather than a reset: whoever calls this can call it
  -- on every app launch, and the first timestamp is the honest one.
  IF v_started IS NULL THEN
    -- Transaction-local, so it is gone the moment this call commits.
    PERFORM set_config('app.trial_grant', 'on', true);

    UPDATE public.companies
      SET trial_started_at = now()
      WHERE id = p_company_id
      RETURNING trial_started_at INTO v_started;

    -- Lower it again immediately: the exemption should cover this one UPDATE
    -- and nothing else that might run later in the same transaction.
    PERFORM set_config('app.trial_grant', 'off', true);
  END IF;

  RETURN v_started;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_estimate_trial(UUID) TO authenticated;
