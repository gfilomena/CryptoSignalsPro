-- Extensions required for backend bot scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Bot configuration (singleton row)
CREATE TABLE public.bot_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initial_capital numeric NOT NULL DEFAULT 10000,
  max_positions int NOT NULL DEFAULT 8,
  min_confidence int NOT NULL DEFAULT 65,
  session_duration_ms bigint NOT NULL DEFAULT 86400000,
  trailing_activation_pct numeric NOT NULL DEFAULT 3.5,
  trailing_step_pct numeric NOT NULL DEFAULT 1.5,
  timeout_ms bigint NOT NULL DEFAULT 28800000,
  timeout_extended_ms bigint NOT NULL DEFAULT 43200000,
  tier_config jsonb NOT NULL DEFAULT '{
    "major":{"maxPerAsset":3,"scalingDropPct":3.0,"sizeMultiplier":1.0,"scalingMultipliers":[1,1.5,2]},
    "altcoin":{"maxPerAsset":2,"scalingDropPct":4.5,"sizeMultiplier":0.75,"scalingMultipliers":[1,1.5]},
    "meme":{"maxPerAsset":1,"scalingDropPct":7.0,"sizeMultiplier":0.5,"scalingMultipliers":[1]}
  }'::jsonb,
  fear_greed_filter jsonb NOT NULL DEFAULT '{
    "extremeFear":25,"fear":40,"greed":75,"extremeGreed":85
  }'::jsonb,
  currency text NOT NULL DEFAULT 'usd',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Market data snapshots (computed by bot-cycle, consumed by frontend)
CREATE TABLE public.market_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.bot_sessions(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}',
  fear_greed_value int,
  fear_greed_label text,
  chf_rate numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add new columns to existing tables
ALTER TABLE public.bot_sessions ADD COLUMN IF NOT EXISTS config_snapshot jsonb;

ALTER TABLE public.bot_trades ADD COLUMN IF NOT EXISTS high_water_mark numeric NOT NULL DEFAULT 0;
ALTER TABLE public.bot_trades ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE public.bot_trades ADD COLUMN IF NOT EXISTS level int NOT NULL DEFAULT 1;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_bot_trades_session ON public.bot_trades(session_id);
CREATE INDEX IF NOT EXISTS idx_bot_trades_status ON public.bot_trades(status);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_status ON public.bot_sessions(status);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_created ON public.market_snapshots(created_at DESC);

-- Enable RLS on all bot tables
ALTER TABLE public.bot_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS Policies: anon can read, service_role has full access
CREATE POLICY "anon_read_config" ON public.bot_config FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_sessions" ON public.bot_sessions FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_trades" ON public.bot_trades FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_snapshots" ON public.market_snapshots FOR SELECT TO anon USING (true);

CREATE POLICY "service_all_config" ON public.bot_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_sessions" ON public.bot_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_trades" ON public.bot_trades FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_snapshots" ON public.market_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow anon to modify bot_config (for frontend settings)
CREATE POLICY "anon_write_config" ON public.bot_config FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_config" ON public.bot_config FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Insert default config row
INSERT INTO public.bot_config (id) VALUES (gen_random_uuid());
