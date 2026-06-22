-- Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_address TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  sgst_percent NUMERIC(5,2) DEFAULT 0,
  sgst_amount NUMERIC(12,2) DEFAULT 0,
  cgst_percent NUMERIC(5,2) DEFAULT 0,
  cgst_amount NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  final_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique invoice numbers per company
CREATE UNIQUE INDEX IF NOT EXISTS invoices_company_number_idx ON invoices(company_id, invoice_number);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS invoices_company_id_idx ON invoices(company_id);
CREATE INDEX IF NOT EXISTS invoices_created_at_idx ON invoices(created_at);

-- Enable RLS
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- Company owners can view their own invoices
CREATE POLICY "Company owners can view own invoices"
  ON invoices FOR SELECT
  TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid()));

-- Company owners can create invoices
CREATE POLICY "Company owners can insert own invoices"
  ON invoices FOR INSERT
  TO authenticated
  WITH CHECK (company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid()));

-- Company owners can update their invoices
CREATE POLICY "Company owners can update own invoices"
  ON invoices FOR UPDATE
  TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid()));

-- Company owners can delete their invoices
CREATE POLICY "Company owners can delete own invoices"
  ON invoices FOR DELETE
  TO authenticated
  USING (company_id IN (SELECT id FROM companies WHERE owner_id = auth.uid()));

-- Master admins can do anything with invoices
CREATE POLICY "Master admins can manage all invoices"
  ON invoices FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'));
