# SIGNAL_CATALOG — every signal/alert the app can emit (state before the fixes)

Frequencies are measured on the 36-month replay (2023-09-01 → 2026-08-31, closed-candle basis) unless stated;
"live-like" = minute-by-minute evaluation with forming candles (see `BACKTEST_REPORT.md` §8). Cooldowns are the code's.

## A. Scalp engine (BTCUSDT spot; trend 4h · structure 1h · entry 15m; evaluated every minute)

Chain (all must hold): `regime ≠ neutral` → ≥ 1 significant zone → structural setup → confirmation → risk valid (R:R ≥ 2, stop ≤ 2.5 ATR, daily limits) → confidence ≥ 60.

| Signal | Exact condition | Parameters | Class | Cooldown / dedupe | Frequency (replay, closed) | Pushed? |
|---|---|---|---|---|---|---|
| `SETUP_DETECTED` | state becomes `LONG_SETUP`/`SHORT_SETUP` from a non-setup state: regime bullish/bearish (EMA20/50/200 stack + slopes + HH/HL), a support (long) / resistance (short) zone touched within the last 8 bars **or** an opposite zone broken and retested; confirmation and/or risk/confidence not satisfied yet | `emaFast/Medium/Slow` 20/50/200, `structureSwingLookback` 10, `zoneLookback` 150, `zonePivotWindow` 3, `zoneMinTouches` 2, `zoneClusterPct` 0.15, `pullbackMaxBars` 8 | INFO | one per state change; 5 min per type | 562 (0.54/day); live-like 1.39/day | **No** |
| `ENTRY_CONFIRMED` | state becomes `*_CONFIRMED`: setup + last 15m candle shows rejection wick > body and closes beyond the zone edge + `calculateRisk` valid (stop = invalidation + 0.25 ATR, ≤ 2.5 ATR; TP = next opposing zone, R:R ≥ 2; ≤ 2 trades/day; ≤ 2 R daily loss) + confidence ≥ 60 (weights: trend 25, breakout 15, pullback 15, volume 10, RSI 10, MACD 10, volatility 10, R:R 5) | `minRiskReward` 2, `maxStopAtr` 2.5, `atrStopBufferMult` 0.25, `minSignalConfidence` 60, `volumeConfirmMult` 1.2 (booster) | **BUY/SELL (LONG/SHORT trade)** | one paper trade open at a time; 5 min per type | 43 (0.041/day); live-like 0.09/day | Yes |
| `EXIT_SUGGESTED` | trade `TRADE_ACTIVE` and ≥ 2 of 3: opposite rejection candle, RSI < 45 (long) / > 55 (short), MACD histogram against the position | — | WARNING | once per open trade | 26 (0.025/day) | Yes |
| `STOP_HIT` | price ≤ stop (long) / ≥ stop (short) | — | INFO (outcome) | once | 27 | Yes |
| `TP1_HIT` / `TP2_HIT` | price reaches target 1 / 2 (engine closes the whole paper trade at the first touched) | — | INFO (outcome) | once | 13 / 3 | Yes |
| `SETUP_INVALIDATED` | state goes `*_SETUP`/`*_CONFIRMED` → `EXPIRED` (setup no longer produced by the engine) | — | INFO | 5 min per type | 535 (0.51/day); live-like 1.3/day | **Yes (before fix)** — 535/535 follow an unpushed `SETUP_DETECTED` |

Notes: the setup "expires" mainly because the 8-bar pullback window rolls past the zone touch (median life 9 bars of 15 min, p25 = 8); it is a time expiry far more often than a market invalidation. `EXPIRED` is never reached from a confirmed entry (the trade goes `TRADE_ACTIVE` → `STOP/TARGET_HIT`).

## B. Smart Alerts (BTCUSDT-perp; evaluated every minute; all `ALWAYS`, push on)

All three live presets use AND, `confirmationCycles = 2`, and (fixed) invalidation events. Direction text comes from `directionLabel()`.

| Preset (essential) | Conditions | Timeframes | Cooldown | Claimed bias | Class | Fires (replay) |
|---|---|---|---|---|---|---|
| `reversal_watch` | 24h price change ≤ −0.5 % **AND** OI change (15m) ≥ +1 % **AND** funding ≤ 0 | 24h (price) / 15m (OI) / last settled (funding) | 15 min | "🟢 Bias rialzista" | WARNING/INFO ("watch") | 38 in 3 y (0.035/day) |
| `strong_momentum` | 24h price change ≥ +0.5 % **AND** volume change (15m) ≥ +20 % **AND** OI change (15m) ≥ +1 % | 24h / 15m / 15m | 30 min | "🟢 Bias rialzista" | INFO | 215 (0.196/day) |
| `overheated_market` | RSI(1h) ≥ 80 **AND** OI change (15m) ≥ +1 % **AND** funding ≥ 0.01 % | 1h / 15m / last settled | 30 min | "🔴 Bias ribassista" | WARNING | 30 (0.027/day); **0 in the last 7 months** |
| `long_squeeze_watch` | 24h price ≤ −0.5 % AND **long liquidations ≥ $5 M** AND OI(15m) ≤ −1 % | — | 15 min | neutral | WARNING | **0 — cannot fire (no liquidation data)** |
| `short_squeeze_watch` | 24h price ≥ +0.5 % AND **short liquidations ≥ $5 M** AND OI(15m) ≤ −1 % | — | 15 min | neutral | WARNING | **0 — cannot fire** |
| `CUSTOM` | user-defined conditions over price, 24h change, OI, OI change, funding, volume, volume change, RSI, liquidations (unavailable) | user | user | neutral | user | user |

Other behaviours: **"invalidated" event** (push title `↩️ Non più valido …`) is emitted the cycle an alert that had fired stops matching; duplicate prevention = cooldown after a fire and a separate cooldown after an invalidation; `SESSION` alerts auto-pause at expiry; an AND with an unavailable metric fails closed, an OR skips it.

## C. Dashboard BUY/SELL score (spot 4h, 200 klines, per asset, no push)

| Signal | Condition | Parameters | Class |
|---|---|---|---|
| `buy` | score ≥ 45 **and** price above EMA200 (score = EMA200 side ±25, RSI divergence ±20, RSI zones, MACD ±8/20, Bollinger ±8/15, OBV divergence ±10, 24h pullback/rally ±8/15); hysteresis: a held `buy` survives while score > 20 | thresholds ±45 / ±20 | BUY |
| `sell` | score ≤ −45 and price below EMA200 | same | SELL |
| `neutral` | otherwise (also when the EMA200 filter vetoes) | — | INFO |

Frequency (replay, entries into the state): 196 buy / 173 sell over 36 months (≈ 0.18 / 0.16 per day, per asset); time share buy 7.6 %, sell 6.7 %, neutral 85.7 %.

## D. Structural observations about the catalog

* **Nothing labelled BUY/SELL is pushed with a direction claim except `ENTRY_CONFIRMED`**; the Smart Alerts push a *bias* label, deliberately softened after an earlier "COMPRA/VENDI" attempt was reverted (see comment in `notificationCopy.ts`).
* **Redundancy / selectivity** (share of 5-minute steps in which each single condition is true, decision range): 24h price ≤ −0.5 %: 34.7 %; 24h price ≥ +0.5 %: 39.9 %; volume change (15m) ≥ +20 %: 34.2 %; funding ≥ 0.01 %: 40.8 %; funding ≤ 0: 11.0 %; RSI(1h) ≥ 80: 3.8 %; **OI change (15m) ≥ +1 %: 0.55 %**. So the binding gate of every preset is the OI condition (plus RSI ≥ 80 for `overheated_market`); the price, volume and funding conditions are true a third to a half of the time and add almost nothing to *when* the alert fires (`BACKTEST_REPORT.md` §9, ablation, shows they add no forward information either).
* **Contradictions**: none (no preset contains mutually exclusive conditions). `strong_momentum` (price↑, OI↑) and `reversal_watch` (price↓, OI↑) both claim a *bullish* bias from opposite price moves — consistent only if one reads them as "momentum" vs "capitulation", which the data does not distinguish.
* **Unreachable**: two liquidation presets; `OPEN_INTEREST` (absolute) and `VOLUME` (24h) exist as metrics but no preset uses them.
* **Oversensitive / arbitrary thresholds**: every threshold is a round number (0.5 %, 1 %, 20 %, 80, 0.01) with no derivation; `funding ≥ 0.01` equals the Binance neutral clamp (§C of `PARAMETER_AUDIT.md`).
