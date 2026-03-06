
-- Add UPI payment fields to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS upi_id text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS upi_qr_url text;
