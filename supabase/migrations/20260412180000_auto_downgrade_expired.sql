-- Migration: Auto-downgrade expired subscriptions via pg_cron + pg_net
-- This sets up a daily cron job that calls the check-expired-subscriptions edge function

-- Enable required extensions (already enabled on most Supabase projects)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the cron job to run daily at 6:00 AM IST (00:30 UTC)
-- The job calls the check-expired-subscriptions edge function via HTTP POST
SELECT cron.schedule(
  'check-expired-subscriptions',        -- job name
  '30 0 * * *',                          -- cron expression: daily at 00:30 UTC (6:00 AM IST)
  $$
  SELECT net.http_post(
    url := 'https://yoiqsyjitpchkbodkvpa.supabase.co/functions/v1/check-expired-subscriptions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvaXFzeWppdHBjaGtib2RrdnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMjM0MjAsImV4cCI6MjA4NzU5OTQyMH0.O6w0EsrX_TlNLuy-_V6vcFv-0nzmhQ_9gB0IlLSUlRY'
    ),
    body := '{}'::jsonb
  );
  $$
);
