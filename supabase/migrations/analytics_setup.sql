-- Create the analytics events table
CREATE TABLE IF NOT EXISTS public.analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type TEXT NOT NULL, -- e.g., 'page_view', 'product_click', 'whatsapp_click'
    page_url TEXT,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
    ip_hash TEXT,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

-- Policy 1: Anyone can insert analytics events (needed for anonymous tracking)
CREATE POLICY "Anyone can insert analytics events" 
ON public.analytics_events 
FOR INSERT 
TO public
WITH CHECK (true);

-- Policy 2: Only Master Admins can view analytics events
CREATE POLICY "Admins can view analytics events"
ON public.analytics_events
FOR SELECT
TO authenticated
USING (
  public.has_role('admin', auth.uid())
);

-- Allow Master Admins to delete history if needed
CREATE POLICY "Admins can delete analytics events"
ON public.analytics_events
FOR DELETE
TO authenticated
USING (
  public.has_role('admin', auth.uid())
);

-- Optional: Create indexes for performance on grouping queries
CREATE INDEX IF NOT EXISTS analytics_events_company_id_idx ON public.analytics_events (company_id);
CREATE INDEX IF NOT EXISTS analytics_events_event_type_idx ON public.analytics_events (event_type);
