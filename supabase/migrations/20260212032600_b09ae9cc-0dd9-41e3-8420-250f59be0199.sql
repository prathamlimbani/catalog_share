-- Add feature_sizes JSONB column to map each feature/variant to its available sizes
-- Example: {"Black": ["S", "M", "L"], "Red": ["M", "XL"]}
ALTER TABLE public.products ADD COLUMN feature_sizes jsonb DEFAULT '{}'::jsonb;