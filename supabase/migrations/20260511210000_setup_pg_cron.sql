-- Schedule bot-cycle Edge Function to run every 30 seconds.
--
-- NOTE: Replace <SUPABASE_ANON_KEY> with your project's anon key.
-- The anon key is safe to use here because bot-cycle is deployed with verify_jwt=false.
-- The service_role_key is accessed internally via Deno.env inside the Edge Function.
--
-- To find your anon key:
--   Supabase Dashboard > Settings > API > Project API Keys > anon (public)

SELECT cron.schedule(
  'bot-cycle-30s',
  '30 seconds',
  $$SELECT extensions.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/bot-cycle'::text,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUPABASE_ANON_KEY>'
    )
  )$$
);
