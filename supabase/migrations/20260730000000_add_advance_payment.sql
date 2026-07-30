-- Add advance_payment column to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS advance_payment NUMERIC(12,2) DEFAULT 0;
