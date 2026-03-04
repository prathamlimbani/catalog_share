-- RPC function for master admin to reset a company's subscription
-- Uses SECURITY DEFINER to bypass RLS, with built-in admin role check
CREATE OR REPLACE FUNCTION public.admin_reset_subscription(target_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is a master admin
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Access denied. Master admin privileges required.';
  END IF;

  UPDATE public.companies
  SET subscription_plan = 'free',
      subscription_expires_at = NULL
  WHERE id = target_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found.';
  END IF;
END;
$$;
