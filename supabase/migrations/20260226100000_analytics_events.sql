-- Migration for tracking analytics (page views and clicks)
CREATE TABLE public.analytics_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_type TEXT NOT NULL, -- e.g., 'page_view', 'product_click'
    page_url TEXT, -- url path, like '/' or '/store/slug'
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE, -- NULL for landing page
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE, -- NULL if just a page view
    ip_hash TEXT, -- To distinguish unique visitors without storing plain IPs
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Allow inserting events anonymously
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert analytics events"
    ON public.analytics_events FOR INSERT
    WITH CHECK (true);

-- Only master admins can read analytics events
CREATE POLICY "Admins can view analytics events"
    ON public.analytics_events FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_roles.user_id = auth.uid()
            AND user_roles.role = 'admin'
        )
    );

-- Create some helpful indexes for faster querying
CREATE INDEX idx_analytics_event_type ON public.analytics_events(event_type);
CREATE INDEX idx_analytics_company_id ON public.analytics_events(company_id);
CREATE INDEX idx_analytics_created_at ON public.analytics_events(created_at);
