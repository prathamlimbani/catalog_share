-- Add status column to suggestions table for tracking read/solved state
ALTER TABLE public.suggestions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';

-- Allow admins to update suggestions (to mark as read/solved)
CREATE POLICY "Admins can update suggestions"
  ON public.suggestions FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
