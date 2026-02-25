
-- Add company about/contact fields
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contact_name_1 text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contact_phone_1 text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contact_name_2 text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contact_phone_2 text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS google_maps_url text;
