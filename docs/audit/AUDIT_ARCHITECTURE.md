# AUDIT_ARCHITECTURE — how the BTCUSDT signal engines are built

Scope: read-only discovery (Phases 1–2). Nothing was changed while this map was drawn. File references are at
commit `0892b26` (the audit branch base), before the fixes listed in `CHANGELOG_SIGNAL_ENGINE.md`.

## 1. There are three signal producers, not one

| # | Engine | Purpose | Data (Binance) | Where it runs | Output |
|---|---|---|---|---|---|
| A | **Scalp engine** ("prudent mode") | Structured LONG/SHORT setups on BTCUSDT with stop/targets, paper trading | **Spot** `api.binance.com` klines 4h / 1h / 15m | Browser (`signalClient.ts`, fallback) **and** Supabase Edge `signal-cycle` (every 1 min) | Signal state + alerts: SETUP_DETECTED, ENTRY_CONFIRMED, EXIT_SUGGESTED, STOP_HIT, TP1_HIT, TP2_HIT, SETUP_INVALIDATED; paper trades; push |
| B | **Smart Alerts** | User-defined market-condition alerts (3 live presets + custom) on price / OI / funding / volume / RSI | **USDT-M futures** `fapi.binance.com` (ticker, openInterest, openInterestHist, premiumIndex, klines) | Browser fallback (`localEvaluator.ts`) **and** Edge `smart-alerts-cycle` (every 1 min) | "fired" and "invalidated" events; push |
| C | **Dashboard BUY/SELL score** | A −100…+100 score → `buy` / `sell` / `neutral` badge per asset | **Spot** 4h klines (200) + ticker/24hr | Browser only (`marketData.ts` → `liveSignal.ts`) | Badge + reasons; no push |
| — | Bot (`bot-cycle`, `backtest*.js`, `backtest/engine.ts`) | Separate multi-asset paper-trading bot | Spot | Edge `bot-cycle` | Out of scope (not a BTCUSDT signal engine); noted only |

Whale transactions (`whale.ts`, `whale-proxy`) are a display feature, not a signal.

## 2. Repository map (relevant files)

```
src/lib/scalp/            strategyEngine.ts   evaluateSetup(): regime → zones → setup → confirmation (pure)
                          regime.ts           4h EMA20/50/200 + swing-structure regime
                          zones.ts, levels.ts 1h pivot clusters → support/resistance; ZONE_REACTION / BREAKOUT_PULLBACK_RETEST
                          confirmation.ts     rejection wick + reclaim (mandatory); volume/RSI/MACD (boosters only)
                          riskEngine.ts       stop = invalidation + ATR buffer; TP = next opposing zone; min R:R; daily limits
                          confidenceScore.ts  0-100 weighted score (min 60 to be CONFIRMED)
                          signalStateMachine.ts / alertEngine.ts   states → alert types, 5-min per-type cooldown
                          exitSignal.ts       "consider closing" (2 of 3: wick, RSI, MACD)
                          paperTrading.ts     costs snapshot (0.12 % round trip), stats
                          backtest.ts         runBacktest(): chronological replay of the same pure functions
                          klines.ts, signalClient.ts, remoteConfig.ts   I/O
src/lib/smartAlerts/      marketData.ts       snapshot builder (futures REST)
                          conditionEngine.ts  evaluateAlert / processAlert (confirmation cycles, cooldown, invalidation)
                          presets.ts, metricDefs.ts, notificationCopy.ts, localEvaluator.ts, alertStore.ts, api.ts
src/lib/liveSignal.ts + marketData.ts + indicators.ts     dashboard score
src/config/strategyConfig.ts    all scalp thresholds (DEFAULT_STRATEGY_CONFIG), PUSH_ALERT_TYPES
supabase/functions/signal-cycle          Deno port of engine A (748 lines, hand-copied)
supabase/functions/smart-alerts-cycle    Deno port of engine B (hand-copied)
supabase/functions/signal-data, push-subscribe, push-test, market-data, whale-proxy, bot-*
supabase/migrations/      scalp_config, scalp_signal_state, scalp_alerts, scalp_paper_trades, smart_alerts,
                          smart_alert_events, push_subscriptions, bot_config, market_snapshots; pg_cron every minute
scripts/run-scalp-backtest.ts    CLI wrapper around runBacktest (last N days, REST paging)
```

## 3. Data flow

```
Binance spot klines ─┐                                   ┌─ closed? NO (before fix) ─ forming candle included
 4h(300) 1h(220) 15m(150)                                  │
        └─ fetchCandles ─▶ evaluateSetup ─▶ calculateRisk ─▶ calculateConfidenceScore ─▶ nextSignalState ─▶ buildAlert
                                                                                              │                │
                              paper trade open/close ◀────────────────────────────────────────┘                ▼
                                                                                        scalp_alerts (DB) ─▶ web-push (PUSH_ALERT_TYPES)

Binance futures REST ─▶ fetchSmartAlertSnapshot (≈15 requests/min/symbol) ─▶ evaluateAlert ─▶ processAlert
   ticker/24hr, openInterest, openInterestHist(5m,15m,1h,4h), premiumIndex, klines(5m,15m,1h,4h)      │
                                                                                  smart_alert_events ─▶ web-push
```

* Both cycles are scheduled with `pg_cron` **every minute**; the browser runs the same code as a fallback.
* Engine logic is **duplicated** in the Deno functions (no shared package). Every audit fix therefore had to be applied
  twice (client + server). Drift between the copies is a standing risk; parity was checked by reading and is noted in
  `PARAMETER_AUDIT.md`.
* No WebSocket is used anywhere. Everything is REST polling; there is no reconnect logic because there is no persistent connection.

## 4. Historical-data flow (what is stored)

| Store | Content | Enough to backtest? |
|---|---|---|
| `scalp_alerts`, `scalp_paper_trades`, `scalp_signal_state` | alert history, paper trades, last state | Alerts yes (with `reasons`); **no candle/indicator history**, so a live alert cannot be re-derived later |
| `smart_alert_events` | fired/invalidated events with the full metric snapshot at that time | Good for post-hoc study of *fired* events only |
| **No table stores market data** (klines, OI, funding) | — | Backtests must re-download history; this audit uses the Binance bulk archive (`data.binance.vision`) |

`market_snapshots` (bot) is unrelated to these engines.

## 5. Existing testing / backtest infrastructure

* 20 unit-test files (vitest) covering each pure scalp function and the Smart Alerts modules; 133 tests at audit start.
* `runBacktest()` **exists and is correct**: on four 100-day windows the audit replay reproduced its trades 19/19
  (entry time + result identical). Limitations: it records only executed trades (no alert-level statistics), it is
  O(n²) (`entryCandles.slice(0, i+1)` and unbounded indicator windows each bar, unusable beyond a few months), and it
  feeds the engine the whole history instead of the 300/220/150-candle windows the live path uses.
* No backtest exists for Smart Alerts or for the dashboard score.

## 6. Dependencies between components (things that couple)

1. `PUSH_ALERT_TYPES` (client) ↔ `PUSH_ALERT_TYPES` (`signal-cycle`) ↔ default list in `push-subscribe` ↔ `ALL_ALERT_TYPES` (`pushClient.ts`, the user-facing toggles): four hand-synced lists.
2. `conditionEngine.processAlert` ↔ inline copy in `smart-alerts-cycle` (firing, confirmation, invalidation).
3. `marketData.ts` (smart alerts) ↔ its Deno copy (same endpoints, same parsing).
4. `notificationCopy.directionLabel` claims a directional *bias* per category; that claim is what the audit tests.
5. Scalp engine uses spot; Smart Alerts use futures; the dashboard uses spot 4h. Prices differ by 0.046 % on average (max 0.83 %) between the two venues over the dataset — immaterial for these horizons but the two engines are not looking at the same tape.
