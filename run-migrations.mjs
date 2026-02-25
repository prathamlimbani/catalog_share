// Run this script to apply migrations to your Supabase database
// Usage: node run-migrations.mjs
// You can also just paste the SQL directly in the Supabase SQL Editor at:
// https://supabase.com/dashboard/project/fspnvgvnqgtrlttrfgxm/sql/new

const SUPABASE_URL = "https://fspnvgvnqgtrlttrfgxm.supabase.co";

// You need your service_role key (NOT the anon key) from:
// https://supabase.com/dashboard/project/fspnvgvnqgtrlttrfgxm/settings/api
// Under "Service role key" (the secret one)
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
    console.error("❌ Please provide your Service Role Key:");
    console.error("   Set SUPABASE_SERVICE_ROLE_KEY environment variable, e.g.:");
    console.error('   $env:SUPABASE_SERVICE_ROLE_KEY="your-key-here"');
    console.error("   node run-migrations.mjs");
    console.error("");
    console.error("   Find it at: https://supabase.com/dashboard/project/fspnvgvnqgtrlttrfgxm/settings/api");
    console.error("   Under 'service_role' (the secret key, NOT the anon key)");
    process.exit(1);
}

const SQL = `
-- Migration 1: Suggestions and Surveys tables
CREATE TABLE IF NOT EXISTS public.suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_slug text,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'customer',
  rating integer NOT NULL DEFAULT 5,
  suggestion text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'suggestions' AND policyname = 'Anyone can insert suggestions') THEN
    CREATE POLICY "Anyone can insert suggestions" ON public.suggestions FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'surveys' AND policyname = 'Anyone can insert surveys') THEN
    CREATE POLICY "Anyone can insert surveys" ON public.surveys FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'suggestions' AND policyname = 'Admins can view suggestions') THEN
    CREATE POLICY "Admins can view suggestions" ON public.suggestions FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'surveys' AND policyname = 'Admins can view surveys') THEN
    CREATE POLICY "Admins can view surveys" ON public.surveys FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'suggestions' AND policyname = 'Admins can delete suggestions') THEN
    CREATE POLICY "Admins can delete suggestions" ON public.suggestions FOR DELETE USING (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'surveys' AND policyname = 'Admins can delete surveys') THEN
    CREATE POLICY "Admins can delete surveys" ON public.surveys FOR DELETE USING (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

-- Migration 2: Company about fields
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contact_name_1 text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contact_phone_1 text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contact_name_2 text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contact_phone_2 text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS google_maps_url text;
`;

async function run() {
    console.log("🚀 Running migrations...\n");

    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            Prefer: "return=minimal",
        },
    });

    // The REST API doesn't support raw SQL. Use the pg endpoint instead.
    const pgRes = await fetch(`${SUPABASE_URL}/pg`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ query: SQL }),
    });

    if (!pgRes.ok) {
        // Fallback: try the SQL endpoint used by the dashboard
        const sqlRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: SERVICE_ROLE_KEY,
                Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ sql: SQL }),
        });

        if (!sqlRes.ok) {
            console.error("❌ Could not run migrations via API.");
            console.error("   Please run the SQL manually in the Supabase SQL Editor:");
            console.error("   https://supabase.com/dashboard/project/fspnvgvnqgtrlttrfgxm/sql/new");
            console.error("\n   Copy the SQL from these files:");
            console.error("   1. supabase/migrations/20260225140000_suggestions_surveys.sql");
            console.error("   2. supabase/migrations/20260225193000_company_about_fields.sql");
            process.exit(1);
        }
        console.log("✅ Migrations applied successfully!");
        return;
    }

    console.log("✅ Migrations applied successfully!");
}

run().catch(console.error);
