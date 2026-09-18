-- Smart Alerts: multi-indicator market-condition monitoring alerts (BTC/USDT and other pairs),
-- independent of the scalp signal engine. Mirrors the RLS pattern already used for
-- scalp_config/scalp_alerts (see 20260909090000_create_scalp_signal_tables.sql): the app has no
-- login anywhere, so anon can fully manage its own alert configuration (like scalp_config), while
-- only service_role (the smart-alerts-cycle Edge Function) writes triggered events and updates
-- cooldown/session-expiry bookkeeping.

CREATE TABLE public.smart_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  symbol text NOT NULL,
  mode text NOT NULL DEFAULT 'ALWAYS',
  session_duration text,
  enabled boolean NOT NULL DEFAULT true,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  operator text NOT NULL DEFAULT 'AND',
  cooldown_ms integer NOT NULL DEFAULT 900000,
  push_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_triggered_at timestamptz,
  session_expired boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Triggered-alert history ("Notification History" section). Rows persist even after the alert
-- that produced them is edited or deleted, so history stays a truthful record of what fired.
CREATE TABLE public.smart_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL,
  alert_name text NOT NULL,
  category text NOT NULL,
  symbol text NOT NULL,
  matched_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read boolean NOT NULL DEFAULT false
);

-- Per-device opt-in for Smart Alert push, independent from the scalp engine's alert_types list
-- (kept as a separate boolean rather than folding into push_subscriptions.alert_types, since that
-- column is typed around the scalp engine's AlertType enum).
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS smart_alerts_enabled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_smart_alerts_enabled ON public.smart_alerts(enabled);
CREATE INDEX IF NOT EXISTS idx_smart_alerts_symbol ON public.smart_alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_smart_alert_events_created ON public.smart_alert_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_smart_alert_events_alert_id ON public.smart_alert_events(alert_id);

ALTER TABLE public.smart_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_alert_events ENABLE ROW LEVEL SECURITY;

-- smart_alerts is user-authored configuration (like scalp_config) — anon can fully manage it.
CREATE POLICY "anon_read_smart_alerts" ON public.smart_alerts FOR SELECT TO anon USING (true);
CREATE POLICY "anon_write_smart_alerts" ON public.smart_alerts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_smart_alerts" ON public.smart_alerts FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_smart_alerts" ON public.smart_alerts FOR DELETE TO anon USING (true);
CREATE POLICY "service_all_smart_alerts" ON public.smart_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- smart_alert_events: anon can read/mark-read/delete its own history, but only the cron job
-- (service_role) inserts new triggered events (mirrors scalp_alerts).
CREATE POLICY "anon_read_smart_alert_events" ON public.smart_alert_events FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_smart_alert_events" ON public.smart_alert_events FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_smart_alert_events" ON public.smart_alert_events FOR DELETE TO anon USING (true);
CREATE POLICY "service_all_smart_alert_events" ON public.smart_alert_events FOR ALL TO service_role USING (true) WITH CHECK (true);
