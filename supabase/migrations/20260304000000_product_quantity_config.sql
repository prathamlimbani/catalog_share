-- Add quantity unit and custom quantity toggle to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS allow_custom_quantity boolean DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity_unit text;
