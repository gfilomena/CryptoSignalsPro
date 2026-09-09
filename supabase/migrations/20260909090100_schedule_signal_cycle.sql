-- Schedule signal-cycle Edge Function to run every 1 minute.
--
-- NOTE: Replace <PROJECT_REF> and <SUPABASE_ANON_KEY> with your project's values.
-- The anon key is safe to use here because signal-cycle is deployed with verify_jwt=false.
-- The service_role_key is accessed internally via Deno.env inside the Edge Function.
--
-- To find your anon key:
--   Supabase Dashboard > Settings > API > Project API Keys > anon (public)

SELECT cron.schedule(
  'signal-cycle-1m',
  '* * * * *',
  $$SELECT extensions.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/signal-cycle'::text,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUPABASE_ANON_KEY>'
    )
  )$$
);
