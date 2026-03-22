-- RPC function for master admin to set a company's subscription plan
-- Handles BOTH updating the company plan AND inserting a ₹0 subscription record
-- Uses SECURITY DEFINER to bypass RLS, with built-in admin role check
CREATE OR REPLACE FUNCTION public.admin_set_subscription(target_company_id UUID, new_plan TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires_at TIMESTAMPTZ;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Verify caller is a master admin
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Access denied. Master admin privileges required.';
  END IF;

  -- Validate plan value
  IF new_plan NOT IN ('free', 'growth', 'pro') THEN
    RAISE EXCEPTION 'Invalid plan. Must be free, growth, or pro.';
  END IF;

  -- Set expiry: 30 days for paid plans, NULL for free
  IF new_plan = 'free' THEN
    v_expires_at := NULL;
  ELSE
    v_expires_at := v_now + INTERVAL '30 days';
  END IF;

  -- Update company plan
  UPDATE public.companies
  SET subscription_plan = new_plan,
      subscription_expires_at = v_expires_at
  WHERE id = target_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found.';
  END IF;

  -- Insert ₹0 subscription record for invoice tracking
  INSERT INTO public.subscriptions (company_id, plan, razorpay_payment_id, razorpay_order_id, amount, status, starts_at, expires_at)
  VALUES (target_company_id, new_plan, 'ADMIN-' || EXTRACT(EPOCH FROM v_now)::BIGINT, NULL, 0, 'active', v_now, v_expires_at);
END;
$$;
