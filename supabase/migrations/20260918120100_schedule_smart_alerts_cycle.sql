-- Schedule smart-alerts-cycle Edge Function to run every 1 minute (same cadence as signal-cycle).
--
-- NOTE: Replace <PROJECT_REF> and <SUPABASE_ANON_KEY> with your project's values.
-- The anon key is safe to use here because smart-alerts-cycle is deployed with verify_jwt=false.
-- The service_role_key is accessed internally via Deno.env inside the Edge Function.

SELECT cron.schedule(
  'smart-alerts-cycle-1m',
  '* * * * *',
  $$SELECT net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/smart-alerts-cycle'::text,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUPABASE_ANON_KEY>'
    )
  )$$
);
