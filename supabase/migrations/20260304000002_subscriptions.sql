-- Subscriptions table to track Razorpay payments
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'growth', 'pro')),
    razorpay_payment_id TEXT,
    razorpay_order_id TEXT,
    amount INTEGER NOT NULL DEFAULT 0, -- in paise (19900 = ₹199)
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
    starts_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add subscription_plan column to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'free' CHECK (subscription_plan IN ('free', 'growth', 'pro'));
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP WITH TIME ZONE;

-- RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Company owners can view their own subscriptions
CREATE POLICY "Company owners can view own subscriptions"
    ON public.subscriptions FOR SELECT
    USING (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
    );

-- Company owners can insert subscriptions for their own company
CREATE POLICY "Company owners can insert own subscriptions"
    ON public.subscriptions FOR INSERT
    WITH CHECK (
        company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
    );

-- Master admins can view all subscriptions
CREATE POLICY "Master admins can view all subscriptions"
    ON public.subscriptions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_roles.user_id = auth.uid()
            AND user_roles.role = 'admin'
        )
    );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_company_id ON public.subscriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expires_at ON public.subscriptions(expires_at);
