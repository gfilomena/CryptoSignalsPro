-- Prudent-mode signal engine restructuring: 4h/1h/15m timeframes, zone-based structure, and the
-- new (stricter) risk defaults. Replaces the scalp_config singleton row's JSON wholesale — the
-- old shape (15m/5m timeframes, 0.25% risk, 3 trades/day) is incompatible with the new engine's
-- fields (structureTimeframe, zone*), so a partial merge would leave a half-old/half-new config.
-- Any user customization made through the Setup panel before this migration is intentionally
-- reset to the new prudent defaults; capital/currency can be re-entered from the UI if needed.
UPDATE public.scalp_config SET config = '{
  "symbols": [
    {"symbol":"BTC","name":"Bitcoin","pair":"BTCUSDT","enabled":true},
    {"symbol":"ETH","name":"Ethereum","pair":"ETHUSDT","enabled":false},
    {"symbol":"SOL","name":"Solana","pair":"SOLUSDT","enabled":false},
    {"symbol":"BNB","name":"Binance Coin","pair":"BNBUSDT","enabled":false}
  ],
  "trendTimeframe": "4h",
  "structureTimeframe": "1h",
  "entryTimeframe": "15m",
  "emaFast": 20,
  "emaMedium": 50,
  "emaSlow": 200,
  "structureSwingLookback": 10,
  "rsiPeriod": 14,
  "atrPeriod": 14,
  "swingLookback": 20,
  "pullbackMaxBars": 8,
  "volumeConfirmMult": 1.2,
  "maxStopAtr": 2.5,
  "atrStopBufferMult": 0.25,
  "zoneLookback": 150,
  "zonePivotWindow": 3,
  "zoneMinTouches": 2,
  "zoneClusterPct": 0.15,
  "capital": 100000,
  "capitalCurrency": "usd",
  "riskPerTradePct": 1,
  "minRiskReward": 2.0,
  "maxDailyLossR": 2,
  "maxTradesPerDay": 2,
  "minSignalConfidence": 60,
  "confidenceWeights": {
    "trendAlignment": 25, "breakoutQuality": 15, "pullbackQuality": 15, "volume": 10,
    "rsi": 10, "macd": 10, "volatility": 10, "riskReward": 5
  },
  "alertCooldownMs": 300000,
  "tradingCosts": {"feePct": 0.04, "spreadPct": 0.02, "slippagePct": 0.02}
}'::jsonb, updated_at = now();

-- Keep the column default (used only if a row is ever inserted without an explicit list) in sync
-- with the client's new default alert-type selection: SETUP_DETECTED is still recorded in the
-- signal history but is no longer push-worthy in prudent mode (see PUSH_ALERT_TYPES).
ALTER TABLE public.push_subscriptions
  ALTER COLUMN alert_types SET DEFAULT '["ENTRY_CONFIRMED","STOP_HIT","TP1_HIT","TP2_HIT","SETUP_INVALIDATED"]'::jsonb;
