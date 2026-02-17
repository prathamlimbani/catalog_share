
-- Add in_stock boolean column
ALTER TABLE public.products ADD COLUMN in_stock BOOLEAN NOT NULL DEFAULT true;

-- Add images array column for multiple product images
ALTER TABLE public.products ADD COLUMN images TEXT[] DEFAULT '{}';
