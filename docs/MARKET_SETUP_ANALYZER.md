# MARKET SETUP ANALYZER

A **manual, separate** analysis feature ("Analyze Setup"). It answers one question: *how much historical evidence supports
the current BTCUSDT market configuration?* It compares a frozen snapshot of today's market with 3 years of comparable
historical states and reports what followed them — as **historical frequencies with sample sizes and intervals, never as a
prediction and never as BUY/SELL**. The automatic Signal Engine is untouched and keeps running independently.

## 1. Architecture

```
scripts/audit/download.ts (existing)      Binance bulk archive → .audit-cache/dataset.json
        │
scripts/analyzer/buildStore.ts            features (src/lib/analyzer/features.ts) → public/analyzer/store.bin   (8.7 MB, 101,761 rows)
scripts/analyzer/validate.ts              walk-forward validation → public/analyzer/validation.json
        │                                   (both offline, deterministic)
browser ─ click "Analyze Setup"
   liveSnapshot.ts   fetch live inputs (reuses Smart-Alerts Binance helpers + scalp klines) → freeze T → SAME featureVector()
   analyzerClient.ts → analyzer.worker.ts   (Web Worker: decode store once, keep in memory)
        analyzer.ts   similarity search → outcomes → Wilson probabilities → baselines → bias → robustness → windows → strength
   history.ts        store the analysis (localStorage + optional Supabase `setup_analyses`), later resolve REAL outcomes
   SetupAnalyzerPanel.tsx  (next to the SignalCard; shows engine state vs analyzer bias and their agreement)
```

Why no backend API: the search is ~100k precomputed 22-dimensional vectors (tens of milliseconds) — cheaper in a Worker than a
network round-trip, and it never blocks the UI thread. The store is a static, cacheable asset (not precached by the PWA), decoded
once per page load. (The spec sketched an Angular UI; this project is React.)

## 2. Data sources (only what exists in the app **and** in history)

| Input | Live | History |
|---|---|---|
| Futures 5-minute klines (price, volume) | `fapi/v1/klines` (reuses Smart-Alerts `getJson`/`FAPI_BASE`) | `futures/um/monthly/klines` 5m |
| Open interest (5-minute) | `futures/data/openInterestHist` | `futures/um/daily/metrics` |
| Funding (last **settled**, 8 h) | `fapi/v1/fundingRate` | `futures/um/monthly/fundingRate` |
| 4h trend regime | spot 4h klines via `fetchCandles` + `closedCandles` (scalp) + `detectRegime` (scalp) | spot 4h klines |
| Mark / index price | `premiumIndex` — **shown in the snapshot only** | not archived → **not in the vector** |
| Liquidations, order book, breakout/rejection | **not available** — shown as "not available", never invented | — |

## 3. Features (the final market-state vector: 22 features, 7 groups)

| Group | Features |
|---|---|
| PRICE | `ret_5m, ret_15m, ret_30m, ret_1h, ret_4h, ret_24h` — % change of the futures close |
| OI | `oi_5m … oi_24h` — % change of open interest (latest boundary at least 10 min old, see limitations) |
| FUNDING | `funding_rate` (%), `funding_pct` (percentile vs the previous 270 settlements ≈ 90 d) |
| VOLUME | `vr_5m, vr_15m, vr_30m, vr_1h` = ln( window volume / trailing-3-day average window volume ) |
| VOLATILITY | `vol_ratio` = ln( 1h realised vol / trailing-3-day average ) |
| POSITION | `dist_high_24h`, `dist_low_24h` — % below the 24 h high / above the 24 h low |
| REGIME | `trend_4h` ∈ {−1, 0, +1} from the scalp engine's own 4h EMA + swing-structure regime |

**One function computes the vector for history and for live** (`featureVector`), so they cannot drift apart. It reads only
bars ≤ T (T = close of the observation bar), OI published ≥ 10 min before T, the last settled funding, closed 4h candles ≤ T.

## 4. Normalisation

Robust z-score `(x − median) / (1.4826·MAD)`, clipped to ±5, fitted on **train rows only** (the first 60 % by time). Reason:
market features are fat-tailed; mean/σ scaling lets one crash dominate. Fitting on train means no later data shapes the geometry.
The regime feature is used as is.

## 5. Similarity algorithm (and why)

`d = sqrt( Σ_g (1/7) · mean_{f∈g}(z_f(now) − z_f(hist))² )` — a **group-weighted Euclidean distance on robust z-scores**, an RMS
z-gap: d = 0 identical, d = 1 "a typical feature differs by one robust σ", d ≈ √2 for two unrelated states.

* **Equal group weights** (uninformed prior, not tuned): otherwise 6 price + 6 OI features (highly collinear) drown funding, volume and regime.
* **Rejected**: raw Euclidean (scale-dependent), Mahalanobis (unstable covariance of collinear, non-stationary features), rank/percentile distance (discards magnitude exactly where extreme setups live), cosine (ignores intensity).
* **Threshold τ0 = 0.86**, calibrated **without any outcome** on train rows: median over 300 train queries of the distance to their 3rd-percentile nearest row ("a typical state has ≈ 3 % of history as analogs"). Robustness variants: 0.8, 0.9, 1.0, 1.1 × τ0.

## 6. Historical matching

Candidate rows = one observation per 15 minutes (101,761). Analogs = candidates with `d ≤ τ` inside the chosen window (30/90/180/365/730 days or all). **Regime is a soft filter**: opposite trend regimes add to the distance (feature difference 2), adjacent ones 1 — "an analog from a strong downtrend gets lower similarity". Neighbouring 15-minute states are nearly the same event, so analogs are **de-clustered nearest-first** with a minimum gap of max(horizon, 60 min); every probability is computed on this *effective* N (raw N is shown too).

## 7. Outcomes

For each analog and horizon (5m, 15m, 30m, 1h, 4h, 12h, 24h), from the **close of its observation bar**, using only later bars: forward return, maximum favourable/adverse excursion (from highs/lows), maximum drawdown of the closing path, minutes to MFE / MAE. An outcome that is not yet knowable at the store's end is not used (never partially).

## 8–9. Probabilities and intervals

P(return > 0), > +0.25 %, > +0.5 %, > +1 %, < −0.25 %, < −0.5 %, < −1 % — each shown with its **Wilson 95 % interval** (not a ±SD approximation) on the effective N. UI wording is always *"Among N historically comparable observations (period), BTC had a positive return within h in p % of cases (95 % CI a–b %; unconditional frequency c %). This is a historical frequency, not a prediction."*

## 10. Setup Strength (0–100) — formula

```
S_in     = (S_n · S_sim · S_sep · S_cons · S_rob)^(1/5)     geometric mean of five in-sample components ∈ [0,1]
strength = 100 · S_in · S_oos                                 discounted by demonstrated out-of-sample validity
```
| Component | Definition |
|---|---|
| S_n | min(1, ln(1+n_eff) / ln(1+N_strong)), n_eff = median effective N over the bias horizons 30m/1h/4h |
| S_sim | 1 − mean(analog distance) / median(distance of all candidate states) |
| S_sep | mean over 30m/1h/4h of E(p), p = two-sided binomial test of the analogs' positive-return frequency vs the unconditional one |
| S_cons | share of the 5 displayed horizons whose deviation from baseline has the bias's sign |
| S_rob | share of the four threshold variants that give the same bias |
| S_oos | E(p), p = one-sided test that the method's **out-of-sample** 1h directional accuracy beat the best constant guess (shipped validation) |

E(p) = min(1, −log10(p)/3): p = 0.001 → 1, 0.05 → 0.43, 0.30 → 0.18. It is the strength of the **evidence**, not a probability of profit. A method without out-of-sample validity can never score above 100·S_oos (currently ≤ 17.6). Labels: STRONG ≥ 60, MODERATE ≥ 40, WEAK ≥ 20, otherwise NONE (configurable presentation bins). Only a **directional** bias can be "confirmed".

**Bias rule:** on the horizons 30m/1h/4h, a horizon is *separated* if the Wilson interval of P(return > 0) excludes the unconditional frequency (needs N_eff ≥ 30). ≥ 2 usable horizons required; BULLISH/BEARISH = ≥ 2 separated in one direction and none in the other; otherwise NEUTRAL; fewer than 2 usable → INSUFFICIENT DATA. A bias is a *historical bias*, deliberately not a trading action.

## 11. Sample size

On the **effective** N (configurable in `config.ts`): < 30 INSUFFICIENT DATA · 30–99 LOW SAMPLE · 100–299 MODERATE · ≥ 300 STRONG. Nothing is reported as a frequency below 30.

## 12. Regime detection

4h trend regime from the existing scalp `detectRegime` (EMA20/50/200 stack + slopes + higher-high/higher-low structure): uptrend / range / downtrend, on closed candles only. Volatility enters as the `vol_ratio` feature (vs trailing 3 days) rather than as a hard label. Baselines are also reported for the same regime and for the same 1h momentum direction.

## 13. Out-of-sample validation (`validate.ts`, shipped as `validation.json`)

Chronological 60/20/20 (train → 2025-06-19, validation → 2026-01-24, OOS → 2026-09-01). For **every** past query (every 6 h) the analyzer is run as it would have been: candidate analogs only if `T_analog + 24 h ≤ T_query`. Its calls are compared with what happened. Best constant guess = the better of "always up"/"always down" (hindsight-favouring, conservative):

| Split | Horizon | Directional calls | Accuracy (calls vs best constant guess) | p (one-sided) |
|---|---|---|---|---|
| train (scaler fitted here) | 30m / 1h / 4h | 684 | 55.3 % vs 51.9 % · 53.9 % vs 50.9 % · 51.6 % vs 51.9 % | 0.041 · 0.055 · 0.57 |
| validation | 30m / 1h / 4h | 441 | 53.7 % vs 51.3 % · 52.6 % vs 51.1 % · 50.6 % vs 50.4 % | 0.16 · 0.26 · 0.47 |
| **out-of-sample** | 30m / 1h / 4h | 433 | **50.3 % vs 51.3 % · 52.4 % vs 51.1 % · 52.7 % vs 50.1 %** | **0.65 · 0.30 · 0.15** |

Sign-adjusted mean return of the calls ≈ 0.000 % in every split; Brier skill of the historical frequencies vs the unconditional one: OOS −0.013 / +0.005 / −0.017 (≈ 0). **The method's edge shrinks from nominal-significant in-sample to none out of sample** — consistent with the earlier signal-engine audit. The UI shows this table and feeds it into S_oos.

## 14. Limitations

1. **No demonstrated out-of-sample predictive skill** (table above). The analyzer improves *transparency* (base rates, N, intervals, agreement flag), not forecasting.
2. One instrument, one 3-year path; markets are non-stationary; rare setups have small effective N.
3. Open interest is used as published 10–15 minutes before T (both live and historical); price is live to the bar. Funding is the last settled rate (≤ 8 h old).
4. Liquidations, order book, mark/index history are unavailable and unused. Costs/slippage are **not** in the raw outcomes.
5. The store is static (built to 2026-09-01); recency is measured from the store's end. Rebuild with `download.ts`, `buildStore.ts`, `validate.ts`.
6. Realised-outcome resolution runs when the app is open (client-side); a server cron would make it continuous.

## 15. Known biases

Overlapping/clustered analogs (handled by de-clustering, not eliminated); multiple horizons/windows shown (only 30m/1h/4h decide the bias — fixed a priori); collinearity of price/OI features (equal group weights, untuned); survivorship of a single asset's history; the OOS validity is one number from 433 calls at 1h (a noisy estimate, deliberately conservative through E(p)).

---

## Delivery summary

**Created:** `src/lib/analyzer/{config,stats,features,outcomes,similarity,store,analyzer,strength,liveSnapshot,history,analyzerClient,analyzer.worker}.ts`, `src/components/SetupAnalyzer/SetupAnalyzerPanel.tsx`, `scripts/analyzer/{buildStore,validate}.ts`, `public/analyzer/{store.bin,validation.json}`, `supabase/migrations/20260921130000_create_setup_analyses.sql`, tests (`src/lib/analyzer/__tests__/*`), this document.
**Modified (minimal):** `src/App.tsx` (mount the panel), `smartAlerts/marketData.ts` (export `FAPI_BASE`, `getJson`), `smartAlerts/api.ts` (export `restUrl`, `restHeaders`), `src/index.css`, `src/i18n/messages/{en,it,es}.ts`. **The Signal Engine is not modified.**
**Reused:** Smart-Alerts Binance helpers, scalp `fetchCandles`/`closedCandles`/`detectRegime`/`DEFAULT_STRATEGY_CONFIG`, audit downloader, the PostgREST local-first pattern. **No indicator was re-implemented.**
**DB:** new table `setup_analyses(id, created_at, data jsonb)` with the same anon RLS pattern as `smart_alerts` — migration written, **not applied** (`supabase db push`); without it the history stays local. **API:** none added. **UI:** one collapsible-style panel next to the SignalCard, EN/IT/ES.
**Tests:** 74 new (statistics, features, look-ahead poison tests, similarity, store, analyzer end-to-end determinism and leakage guard, strength, snapshot, history/outcome resolution).

### Questions

* **A. Only information available at each timestamp?** Yes: features read bars ≤ T, OI published ≥ 10 min earlier, last settled funding, closed 4h candles ≤ T; outcomes only from bars after T.
* **B. Look-ahead bias?** None found; tested by replacing all post-T bars/OI/funding with garbage (vector unchanged), and by poisoning post-query bars in validation mode (result unchanged). The scaler and τ0 use train features only, never outcomes.
* **C. Analog selection?** Group-weighted robust-z distance ≤ τ0 (0.86) inside the window, soft regime penalty, de-clustered nearest-first.
* **D. Setup Strength?** `100 · geomean(S_n, S_sim, S_sep, S_cons, S_rob) · S_oos` (§10).
* **E. Confidence?** Wilson 95 % intervals on effective N; two-sided binomial tests against the unconditional frequency; bootstrap only in validation.
* **F. Minimum sample?** Effective N ≥ 30 to report anything; 100 / 300 for MODERATE / STRONG (configurable).
* **G. Reproducible?** Yes: the analysis is a pure function of (store version, frozen vector, config); each history record stores all three. Identical inputs give identical output (tested, including a from-scratch rebuild).
* **H. Works out of sample?** It is evaluated out of sample, and **it does not beat the best constant guess** (§13). It therefore reports WEAK HISTORICAL EVIDENCE by construction.
* **I. Robust to threshold changes?** Reported per analysis (0.8/0.9/1.0/1.1 × τ0) with a LOW ROBUSTNESS flag; at today's snapshot τ×0.8/0.9 collapse to 3/31 analogs → INSUFFICIENT → flagged LOW.
* **J. Better information than the Signal Engine?** Different, not more predictive: it adds base rates, sample sizes, intervals, recency, robustness and an explicit agree/conflict flag against the engine. It adds no measurable directional skill.
