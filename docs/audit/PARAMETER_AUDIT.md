# PARAMETER_AUDIT — which market parameters exist, how they are computed, and how good the data is

Status legend: **OK** = implemented and correct · **OK*** = correct but with a caveat · **DEFECT** = wrong/inconsistent (fixed in this branch unless stated) · **NOT IMPLEMENTED** = absent (documented, deliberately *not* added — see §9).

Evidence for every number below is reproducible with `scripts/audit/*` (see `BACKTEST_REPORT.md` §"How to reproduce").

## A. Price action

| Parameter | Used by | Implementation | Verdict |
|---|---|---|---|
| Current price | B, C | B: `ticker/24hr.lastPrice` (futures). C: `ticker/24hr.lastPrice` (spot). A: close of the last candle | OK* — A used the *forming* candle's close (see §4/§8) |
| Mark price / index price | — | — | **NOT IMPLEMENTED** |
| % price change | B `PRICE_CHANGE`; C `priceChange24h` | **24-hour rolling** `priceChangePercent` | **OK*, and easy to misread**: UI label is "Price change %" with no "24h". `strong_momentum` and `reversal_watch` combine it with 15-minute OI/volume, i.e. mixed horizons (24h price state vs 15m flows). A 24h change ≤ −0.5 % is true in 34.7 % of all 5-minute steps (≥ +0.5 %: 39.9 %) — it is a *state*, not an event |
| Recent highs/lows, S/R | A | `zones.ts`: 1h pivot highs/lows (window 3) clustered within 0.15 %, ≥ 2 touches, last 150 candles | OK. Pivots need 3 candles to the right, so the newest 3 bars can never be pivots — no future leakage inside a slice |
| Short-term momentum | A (MACD/RSI boosters), C | Standard formulas on closes | OK* (RSI variant, §E-RSI) |
| Trend direction | A | 4h: price vs EMA200, EMA20 vs EMA50, both slopes, **and** higher-high/higher-low structure | OK. Regime = neutral 60.6 % of bars, bullish 23.2 %, bearish 16.2 % (3-year replay) |
| Breakout / rejection | A | `ZONE_REACTION`, `BREAKOUT_PULLBACK_RETEST`; confirmation = rejection wick > body **and** reclaim close | OK. Judged on the last candle → must be a *closed* candle (DEFECT before fix) |

## B. Open interest

| Item | Implementation | Verdict |
|---|---|---|
| Current OI | `fapi/v1/openInterest` (BTC, contracts) | OK (stored in snapshot, **not used by any preset**) |
| OI change % (5m/15m/1h/4h) | `futures/data/openInterestHist?period=tf&limit=2`, latest vs previous point | OK* — see timing below |
| Absolute OI change, OI trend, acceleration | — | **NOT IMPLEMENTED** |
| Price × OI quadrant logic | **not implemented in code**; the presets only combine thresholds with AND | see below |

**Timing of `openInterestHist` (verified live, not assumed):** the latest point is the last *boundary* snapshot, not "now". At 10:11 UTC the 15m series ended at 10:00 (11 min stale), the 5m series at 10:05, the 1h series at 10:00. Price/24h change come from the live ticker, so a Smart Alert compares a **live price against an OI value up to `tf` minutes old**. The audit replay reproduces this staleness exactly (publish lag 60 s, then floor to the boundary).

**Data-quality of OI history (Binance bulk archive, 315,515 five-minute points over 36 months):** 133 missing points in 4 gaps (longest 125 points ≈ 10.4 h), 341 rows with `sum_open_interest ≤ 0` (outages; a naive `%change` yields `Infinity`), median 5-min |Δ| 0.051 %, p99 0.404 %. The audit treats `≤ 0` as missing. Live code guards only `prev === 0`.

**What does each price × OI combination actually mean here?** The code does not encode a meaning; it has no quadrant logic. The audit measured what follows each combination (1h price move > ±0.3 %, 1h OI move > ±0.3 %, decision range, raw forward returns, baseline in the last row):

| Quadrant (1h) | n (5-min steps) | fwd 1h | fwd 4h | fwd 24h | %up 4h |
|---|---|---|---|---|---|
| price ↑ + OI ↑ | 13,164 | −0.011 % | +0.002 % | +0.175 % | 48.3 % |
| price ↑ + OI ↓ | 11,566 | +0.033 % | +0.064 % | +0.272 % | 51.4 % |
| price ↓ + OI ↑ | 10,771 | −0.008 % | +0.044 % | +0.236 % | 54.0 % |
| price ↓ + OI ↓ | 12,266 | +0.025 % | +0.029 % | +0.356 % | 55.1 % |
| all steps (baseline) | 252,230 | +0.007 % | +0.029 % | +0.170 % | 51.8 % |

Conclusion: no quadrant moves the forward return by more than ~0.06 % at 4 h (cost of a round trip is 0.12 %). "OI rising" is **not** bullish or bearish by itself; the small tilt toward "up" after price-down quadrants (54–55 % vs 51.8 %) is a weak mean-reversion tendency, not a tradable edge. The code correctly does not claim otherwise for OI alone — but the direction labels in push titles (below) do claim a bias.

## C. Funding rate

| Item | Implementation | Verdict |
|---|---|---|
| Current funding | `premiumIndex.lastFundingRate × 100` (percentage points) | **OK***: this is the **last settled** rate (8 h), not the predicted/next one; it changes only 3× a day |
| Interval / history | BTCUSDT interval is 8 h in all 3,288 historical settlements (`funding_interval_hours`); the app never reads history | OK; no history/trend/extreme detection **NOT IMPLEMENTED** |
| Normalisation | ×100 → 0.01 means 0.01 % | OK |
| Positive funding ⇒ SELL? | **No.** No code path treats funding alone as a signal; funding appears only as one AND-ed condition (`overheated_market`: ≥ 0.01, `reversal_watch`: ≤ 0) | OK (requirement satisfied) |

**Defect in the threshold semantics (not silently changed):** 0.01 % per 8 h is Binance's *default interest-rate clamp*. Over 36 months the settled rate was **exactly 0.01 %** in 25.7 % of periods and **≥ 0.01 %** in 34.0 % (median 0.0059 %, p95 0.0196 %, max 0.0881 %). In the 5-minute replay `funding ≥ 0.01` is true in 40.8 % of steps. So the "overheated" funding condition is a *neutral-market* value, and a ±10 % nudge (0.009 → 0.011) changes the number of `overheated_market` fires from 30 to 5, because the threshold sits on a discrete plateau of the distribution. Forward returns by funding bucket (decision range) show nothing: 4 h mean return −0.011 % … +0.058 % across all six buckets.

## D. Volume

| Item | Implementation | Verdict |
|---|---|---|
| Spot vs futures volume | B: futures. A/C: spot | OK, but the engines disagree on venue |
| Volume change | `VOLUME_CHANGE(tf)`: two most recent **closed** futures candles (forming candle dropped) | OK |
| 24h volume | ticker `quoteVolume` (B), `volume` base (C) | OK |
| Relative volume vs history | A: last candle vs mean of 20 (`volumeConfirmMult` 1.2, booster only) | OK |
| Taker buy/sell imbalance | — | **NOT IMPLEMENTED** in the app; **tested by the audit** (`volumeStudy.ts`, `BACKTEST_REPORT.md` §12): no cell of relative volume × taker imbalance produced an excess return above 0.07 % |

**Defect (dashboard, fixed):** `marketData.ts` appended `currentPrice` after klines that already end with the forming candle (the forming 4h candle counted **twice** in RSI/MACD/EMA/BB) and appended the **24 h** ticker volume to a series of **4 h** volumes before OBV (mixed units, OBV last step ≈ 6× too large). Impact on the score was small (entries 196/173 vs 194/172 buy/sell), but both are plain data errors.

## E. RSI, ATR, MACD (calculation correctness)

* **RSI**: `calculateRSI` uses the *simple average* of gains/losses over the last 14 changes (Cutler), not Wilder smoothing. It is a valid RSI but **not the standard one**: on 20,843 1h bars the repo's RSI ≥ 80 occurs in **3.82 %** of hours vs **0.89 %** for Wilder's (4.3×); ≥ 70: 13.64 % vs 6.07 %; mean absolute difference 6.7 points (max 41.5). A threshold such as "RSI 1h ≥ 80" therefore does not mean what a trader reading "RSI 80" expects. Not changed (would silently re-scale every threshold); recorded as a limitation.
* **ATR**: simple mean of the last 14 true ranges (no Wilder smoothing). Fine for its use (stop sizing).
* **EMA / MACD**: SMA-seeded EMAs, MACD signal = EMA9 of the MACD series. OK. Note the EMA200 is computed over whatever history is passed: live passes 300 candles; `runBacktest` passes the whole history (tiny seed-dependent differences; the audit replay uses the live window sizes).
* Returns 50 (RSI) / 0 (ATR) on insufficient data instead of "unavailable" — harmless here because the engines require warm-up first.

## F. Liquidations

**Not available and never was.** Binance offers no public aggregate long/short-liquidation REST endpoint; `marketData.ts` returns `null` for `LONG_LIQUIDATIONS`, `SHORT_LIQUIDATIONS`, `LIQUIDATION_SPIKE`, and an AND with an unavailable condition fails closed. Consequence, measured: the presets `long_squeeze_watch` and `short_squeeze_watch` fired **0 times in 315,360 five-minute steps** — they can never fire. They were nevertheless offered in the preset grid (fixed: hidden). No liquidation data was invented or estimated. The historical `liquidationSnapshot` archive is also not available for backtesting.

## G. Order book, spread, walls, basis/premium

All **NOT IMPLEMENTED**: no depth/imbalance, no spread (only a fixed 0.02 % cost assumption), no walls, no spot–futures basis, no mark/index divergence. Not added (§9).

## H. Data-source / time-synchronisation audit

| Parameter | Endpoint | Update | Timestamp handling | Notes |
|---|---|---|---|---|
| Scalp klines | `api.binance.com/api/v3/klines` (300×4h, 220×1h, 150×15m) | polled each minute | `openTime/closeTime` ms UTC, kept | last candle forming — **DEFECT (fixed)** |
| Smart snapshot | ticker/24hr, openInterest, openInterestHist ×4, premiumIndex, klines ×8 | each minute, in parallel | `timestamp: Date.now()`; individual metrics carry no timestamp | metrics have different ages: price live, OI up to `tf` old, funding up to 8 h old |
| Dashboard | spot 4h klines + ticker | on refresh | — | forming candle duplicated — **DEFECT (fixed)** |

* **REST vs WebSocket:** REST only, so there is no WS/REST timestamp mixing. The cross-parameter staleness above is the real synchronisation issue.
* **Timezone:** everything is UTC epoch ms, except that a Smart Alert "end of day" session ends at midnight in the *creating device's* timezone (`endOfDay` uses local time) and is then stored as an absolute timestamp. Not a signal-quality issue; not changed.
* **Duplicates / gaps / out-of-order** (36-month archive): spot 15m/1h/4h and futures 5m/15m/1h/4h: **0 duplicates, 0 gaps, 0 unordered, 0 invalid OHLC**; futures 15m has 9 zero-volume candles (exchange maintenance), futures 1h has 1. Spot vs futures 15m closes differ by 0.046 % on average (max 0.834 %).
* **Missing-data handling:** Smart Alerts: unavailable ⇒ condition `null` ⇒ AND fails closed, OR skips it (documented, tested). Scalp: `fetchCandles` throws on HTTP error; no retry/backoff and no rate-limit handling anywhere (the Smart cycle issues ≈ 15 requests/minute per symbol, far below Binance limits, but a 429/418 would silently null every metric).
* **Reconnect / stale data:** not applicable (no sockets); a stalled cycle is invisible to the user (no "last updated" guard on push).
* **Historical availability:** klines, OI (5 m), funding and taker volumes: yes (verified for the 36 months used, 2023-09 → 2026-08). Liquidations, order book, mark/index: no.

## 9. Missing parameters: is any of them *necessary*?

Rule applied (audit brief §16): add a parameter only if (1) there is a real information gap, (2) existing parameters cannot fill it, (3) historical evidence suggests it helps, (4) it is reliably obtainable, (5) it can be backtested without look-ahead.

| Candidate | Gap? | Evidence | Decision |
|---|---|---|---|
| Liquidations | yes (two presets depend on it) | not obtainable historically or by REST | **Do not add** (cannot be validated) |
| Order book / spread / walls | possible | not obtainable historically (no depth archive used) | **Do not add** |
| Basis / premium | possible | obtainable, but no evidence of need: none of the existing OI/funding/volume parameters showed forward information | **Do not add** |
| Taker imbalance / relative volume | asked by the user | backtestable; tested — no excess return above 0.07 % (≪ 0.12 % cost), the two "significant" cells of 36 tests do not replicate out of sample | **Do not add** as a signal; could be shown as context only |
| Funding history/extremes, OI acceleration | marginal | funding buckets and price×OI quadrants show no forward information | **Do not add** |

Conclusion: **no additional parameter is justified by the evidence.** The information problem is not "too few inputs"; the current inputs do not carry measurable directional information at the horizons tested.
