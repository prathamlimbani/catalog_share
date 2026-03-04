-- Drop the old policy that only allowed master admins to view analytics
DROP POLICY IF EXISTS "Admins can view analytics events" ON public.analytics_events;

-- Allow company owners to view analytics for their own company
CREATE POLICY "Company owners can view their analytics events"
    ON public.analytics_events FOR SELECT
    USING (
        company_id IN (
            SELECT id FROM public.companies WHERE user_id = auth.uid()
        )
    );

-- Allow master admins to view ALL analytics
CREATE POLICY "Master Admins can view all analytics events"
    ON public.analytics_events FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE user_roles.user_id = auth.uid()
            AND user_roles.role = 'admin'
        )
    );
