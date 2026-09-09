-- Scalping signal engine: config, live state, alert history, paper trades, push subscriptions.
-- Mirrors the RLS pattern already used for bot_config/bot_sessions/bot_trades (see
-- 20260511205220_upgrade_bot_backend_schema.sql): anon can read the public-facing tables,
-- service_role (used internally by the Edge Functions) has full access.

CREATE TABLE public.scalp_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per tracked symbol; holds the current signal-state-machine snapshot.
CREATE TABLE public.scalp_signal_state (
  symbol text PRIMARY KEY,
  state text NOT NULL DEFAULT 'NO_TRADE',
  regime text NOT NULL DEFAULT 'neutral',
  setup jsonb,
  risk jsonb,
  confidence jsonb,
  daily_risk jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_alert jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.scalp_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  type text NOT NULL,
  state text NOT NULL,
  direction text,
  entry_price numeric,
  stop_loss numeric,
  take_profit_1 numeric,
  take_profit_2 numeric,
  risk_amount numeric,
  reward_amount numeric,
  risk_reward_ratio numeric,
  confidence int,
  capital_currency text,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.scalp_paper_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  direction text NOT NULL,
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit_1 numeric NOT NULL,
  take_profit_2 numeric NOT NULL,
  position_size numeric NOT NULL,
  risk_amount numeric NOT NULL,
  confidence int NOT NULL,
  capital_currency text NOT NULL DEFAULT 'usd',
  cost_pct numeric NOT NULL DEFAULT 0,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  exit_price numeric,
  result text NOT NULL DEFAULT 'OPEN',
  pnl numeric,
  pnl_r numeric
);

-- Web Push subscriptions. Device-based (the app has no login): each browser/device that enables
-- notifications gets one row. alert_types holds which AlertType values the device wants to
-- receive (defaults to all).
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  alert_types jsonb NOT NULL DEFAULT '["SETUP_DETECTED","ENTRY_CONFIRMED","STOP_HIT","TP1_HIT","TP2_HIT","SETUP_INVALIDATED"]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scalp_alerts_symbol_created ON public.scalp_alerts(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scalp_paper_trades_symbol_opened ON public.scalp_paper_trades(symbol, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_scalp_paper_trades_status ON public.scalp_paper_trades(result);

ALTER TABLE public.scalp_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scalp_signal_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scalp_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scalp_paper_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_scalp_config" ON public.scalp_config FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_scalp_state" ON public.scalp_signal_state FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_scalp_alerts" ON public.scalp_alerts FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_scalp_paper_trades" ON public.scalp_paper_trades FOR SELECT TO anon USING (true);
-- push_subscriptions is never read/written directly by anon: only the push-subscribe and
-- push-test Edge Functions (service_role) touch it, so endpoints/keys stay private.

CREATE POLICY "service_all_scalp_config" ON public.scalp_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_scalp_state" ON public.scalp_signal_state FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_scalp_alerts" ON public.scalp_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_scalp_paper_trades" ON public.scalp_paper_trades FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_push_subscriptions" ON public.push_subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow anon to tune strategy parameters from the app's Setup panel (mirrors bot_config).
CREATE POLICY "anon_write_scalp_config" ON public.scalp_config FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_scalp_config" ON public.scalp_config FOR UPDATE TO anon USING (true) WITH CHECK (true);

INSERT INTO public.scalp_config (config) VALUES ('{
  "symbols": [
    {"symbol":"BTC","name":"Bitcoin","pair":"BTCUSDT","enabled":true},
    {"symbol":"ETH","name":"Ethereum","pair":"ETHUSDT","enabled":false},
    {"symbol":"SOL","name":"Solana","pair":"SOLUSDT","enabled":false},
    {"symbol":"BNB","name":"Binance Coin","pair":"BNBUSDT","enabled":false}
  ],
  "trendTimeframe": "15m",
  "entryTimeframe": "5m",
  "emaFast": 20,
  "emaMedium": 50,
  "emaSlow": 200,
  "rsiPeriod": 14,
  "atrPeriod": 14,
  "swingLookback": 20,
  "pullbackMaxBars": 12,
  "volumeConfirmMult": 1.2,
  "maxStopAtr": 2.5,
  "atrStopBufferMult": 0.25,
  "capital": 92000,
  "capitalCurrency": "chf",
  "riskPerTradePct": 0.25,
  "minRiskReward": 2.0,
  "maxDailyLossR": 2,
  "maxTradesPerDay": 3,
  "minSignalConfidence": 70,
  "confidenceWeights": {
    "trendAlignment": 25, "breakoutQuality": 15, "pullbackQuality": 15, "volume": 10,
    "rsi": 10, "macd": 10, "volatility": 10, "riskReward": 5
  },
  "alertCooldownMs": 300000,
  "tradingCosts": {"feePct": 0.04, "spreadPct": 0.02, "slippagePct": 0.02}
}'::jsonb);
