
-- Create suggestions table (from About page)
CREATE TABLE IF NOT EXISTS public.suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create surveys table (from store front page)
CREATE TABLE IF NOT EXISTS public.surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_slug text,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'customer',
  rating integer NOT NULL DEFAULT 5,
  suggestion text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;

-- Anyone can insert suggestions/surveys (public forms)
CREATE POLICY "Anyone can insert suggestions"
  ON public.suggestions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can insert surveys"
  ON public.surveys FOR INSERT
  WITH CHECK (true);

-- Only master admins can read suggestions
CREATE POLICY "Admins can view suggestions"
  ON public.suggestions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Only master admins can read surveys
CREATE POLICY "Admins can view surveys"
  ON public.surveys FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Admins can delete suggestions/surveys
CREATE POLICY "Admins can delete suggestions"
  ON public.suggestions FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete surveys"
  ON public.surveys FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::app_role));
