# BACKTEST_REPORT — BTCUSDT signal engines, 36-month chronological replay

Research/validation only. Nothing here says a signal *predicts* price; every statement is about historical
distributions. Rules for classification were frozen **before** the out-of-sample unblinding (`PRE_REGISTRATION.md`,
commit `0892b26`).

## 1. Dataset

| Series | Source file family (`data.binance.vision`) | Rows |
|---|---|---|
| BTCUSDT **spot** klines 15m / 1h / 4h | `spot/monthly/klines` | 105,216 / 26,304 / 6,576 |
| BTCUSDT-perp klines 5m / 15m / 1h / 4h | `futures/um/monthly/klines` | 315,648 / 105,216 / 26,304 / 6,576 |
| Open interest (5-min snapshots) | `futures/um/daily/metrics` | 315,515 (133 missing, 341 non-positive → treated as missing) |
| Funding-rate settlements | `futures/um/monthly/fundingRate` | 3,288 (8 h interval throughout) |
| Spot 1m klines (repaint study only) | `spot/monthly/klines` 1m | 175,680 per 4-month window, two windows |
| Taker-buy volume (volume study only) | 10th column of the spot 1h klines | 26,304 |

Integrity: 0 duplicates, 0 gaps, 0 out-of-order, 0 invalid OHLC in every kline series (`scripts/audit/dataQuality.ts`).
Spot archives switched to **microsecond** timestamps in 2025; normalised to ms (a silent 1000× error otherwise).

## 2. Historical period and splits

2023-09-01 00:00 UTC → 2026-08-31 23:59 UTC (1,096 days). Chronological, never shuffled:

| Split | From → to (UTC) | Share |
|---|---|---|
| Train | 2023-09-01 → 2025-06-19 14:24 | 60 % |
| Validation | 2025-06-19 14:24 → 2026-01-24 19:12 | 20 % |
| **Out-of-sample** | 2026-01-24 19:12 → 2026-09-01 | 20 % |

No parameter was fitted (this audits the shipped defaults), so "train/validation" are two consecutive characterisation
periods and the decision range is their union; OOS is a one-shot confirmation. Volatility-regime cut points are fitted on train only.

## 3. Timeframes

Scalp: trend 4h · structure 1h · entry 15m, evaluated on each closed 15m bar. Smart Alerts: 5-minute steps (OI resolution);
metric timeframes 15m/1h. Dashboard: 4h klines evaluated every closed hour that falls inside a 4h candle. Forward horizons
(scalp/dashboard): 15m–3d; (Smart): 5m, 15m, 30m, 1h, 4h, 12h, 24h. **Primary horizon fixed a priori: 4h.**

## 4. Data sources

Historical: bulk archive above (immutable once published ⇒ reproducible). Live behaviour reproduced against the live REST API
where it mattered (OI publication lag, §5).

## 5. Assumptions (all conservative or explicit)

1. Signal known at the **close** of the signal bar; forward return measured from that close. A variant entering at the **next bar's open** (1-bar delay) is reported; differences are ≤ 0.01 % in every table (bars are contiguous), i.e. execution delay of one bar does not matter at these horizons.
2. Smart Alerts snapshot rebuilt as-of each 5-minute close: live-ticker price, **24h rolling** change, OI = last two *boundary* points published ≥ 60 s earlier (verified live: 15m OI is up to 11 min stale), last **settled** funding, RSI = closed 1h closes + the current price as the forming candle (as the live code does), volume change = two most recent closed 15m candles.
3. Smart Alerts confirmation: the live default is 2 cycles of **1 minute**, but the data refresh every 5–15 minutes, so two consecutive minute-cycles see the same OI/funding; the replay therefore uses **1 step (5 min)** as live-equivalent and reports 2 steps as a sensitivity.
4. Direction hypothesis = what the alert claims (`directionLabel`). Scalp: direction of the setup.
5. Within a bar, if stop and target are both touched the stop is assumed first (engine rule, conservative). In first-passage tables a same-bar double touch counts as adverse.
6. Paper-trade exits: the engine's own SL/TP; costs from `tradingCosts`.

## 6. Fees / slippage

Round trip = 2 × 0.04 % fee + 0.02 % spread + 0.02 % slippage = **0.12 %** (`DEFAULT_STRATEGY_CONFIG`). Reported **gross and net** everywhere.
Context for the scalp engine: a typical stop is ≈ 0.38 % of price, so the same 0.12 % cost is ≈ **0.31 R per trade** (mean gross R −0.03 vs mean net R −0.35 on the decision range). No zero-cost result is used to judge usefulness.

## 7. Methodology

* Replay = the real pure functions (`evaluateSetup → calculateRisk → calculateConfidenceScore → nextSignalState → buildAlert`, `processAlert`, `analyzeLiveSignal`), not re-implementations. Windows equal the live ones (300×4h, 220×1h, 150×15m).
* Harness validated against the existing `runBacktest()` on four 100-day windows: **19/19 trades identical** (entry time and result).
* Per event: direction-adjusted gross/net return at each horizon, MFE/MAE, first-passage of ±0.25/0.5/1/2 % (target before adverse), % positive, **excess over the unconditional mean of the same direction, range and horizon** (removes BTC drift), seeded bootstrap 95 % CI (B = 2000, seed 12345), and `n_indep` (events ≥ horizon apart) because events cluster.
* Perturbation: ±10 % on every numeric threshold, one at a time; condition ablation (every subset of a preset's AND); confirmation 1 vs 2; regime slices (4h regime from EMA+structure; volatility terciles fitted on train).

## 8. Look-ahead-bias controls — and what they found

| Control | Result |
|---|---|
| Windows ≤ bar close: candles with `closeTime ≤` signal time only; forward returns only from bars after the signal | Implemented in the harness |
| **Truncation invariance** (unit test): removing all data after time T leaves every event ≤ T unchanged; 3 cut points, non-vacuous (≥ 12 events) | Pass |
| **Future poisoning** (unit test): replacing all post-T candles with garbage leaves events ≤ T unchanged | Pass |
| Determinism: same data + config ⇒ identical events/trades; two full independent runs of the three audit runners (decision range and `--oos`) ⇒ their 6 result JSON files are **byte-identical** | Pass |
| Zone pivots (window 3 to the right) | Confirmed pivots only inside a slice; newest 3 bars cannot be pivots |
| `runBacktest()` / replay | **No look-ahead** |
| **Live vs backtest: repainting** | **Found — see below** |

**Look-ahead: NO. Repainting/inconsistency between live and backtest: YES (fixed).**

**Repaint study** (`repaintStudy.ts`): the live code (client and Edge function) evaluates *every minute* on Binance klines whose last candle is still forming, on all three timeframes; the backtest only sees closed candles. Replaying the live behaviour from 1-minute data (forming candles assembled from the minutes seen so far — no future information), two independent 122-day windows:

| Window | Metric | Live-like (forming candle) | Closed-candle replay | After the fix (closed signals, 1-min price for SL/TP) |
|---|---|---|---|---|
| 2025-09-01 → 2026-01-01 | SETUP_DETECTED / ENTRY_CONFIRMED / SETUP_INVALIDATED | 169 / **11** / 158 | 53 / 4 / 50 | 53 / 5 / 50 |
| | paper trades, mean net R, total | 11, −0.55 R, −6.00 R | 4, +0.50 R, +2.02 R | 5, −0.04 R, −0.20 R |
| | intrabar entries still valid at the candle close | **4 of 11 (36.4 %)** | — | — |
| 2026-03-01 → 2026-07-01 | SETUP_DETECTED / ENTRY_CONFIRMED / SETUP_INVALIDATED | 253 / **13** / 240 | 69 / 6 / 63 | 70 / 6 / 64 |
| | paper trades, mean net R, total | 13, −0.41 R, −5.39 R | 6, −0.39 R, −2.33 R | 6, −0.39 R, −2.33 R |
| | intrabar entries still valid at the candle close | **5 of 13 (38.5 %)** | — | — |

So live generated **2.2–2.75× more entries and 3.2–3.7× more setup/invalidation alerts** than what was ever backtested, and ~63 % of the intrabar entries disappear by the close. The window sizes are small (24 live-like trades in total) — the *rate* of repainting is well supported (n = 24 entries, 400+ setup alerts), the *expectancy* comparison is not. After the fix the live-like behaviour reproduces the backtest (window B identical, window A 5 vs 4 entries).

## 9. Results by signal (decision range = train + validation; OOS in §10)

### 9.1 Scalp engine alerts — direction-adjusted to the setup direction, 4 h horizon

| Signal | n | n_indep | mean gross | baseline | excess net [95 % CI] | first-passage 4h ±0.5 % (target / adverse) |
|---|---|---|---|---|---|---|
| SETUP_DETECTED (not pushed) | 420 | 369 | +0.013 % | +0.009 % | −0.117 % [−0.207, −0.024] | 37.4 % / 39.5 % |
| **ENTRY_CONFIRMED** | 30 | 30 | **−0.236 %** | +0.006 % | −0.362 % [−0.785, +0.049] | 40.0 % / 46.7 % |
| SETUP_INVALIDATED (pushed) | 403 | 364 | +0.059 % | +0.009 % | −0.070 % [−0.150, +0.013] | 34.0 % / 40.4 % |

At 15m–1h the net return of all three is ≈ −0.11 … −0.15 % (= the cost; gross ≈ 0). At 24h SETUP_DETECTED and SETUP_INVALIDATED show a positive gross mean (+0.31 %, +0.36 %; excess net +0.13 %, +0.18 %) with CIs that include 0; that horizon was not pre-declared and is not used.

**Executed paper trades (the engine's own SL/TP, costs included):**

| Range | n | win rate | mean net R [95 % CI] | mean gross R | profit factor | total net R |
|---|---|---|---|---|---|---|
| Train | 20 | 30.0 % | −0.428 [−1.006, +0.201] | −0.100 | 0.54 | −8.56 |
| Validation | 10 | 30.0 % | −0.183 [−1.214, +0.966] | +0.100 | 0.80 | −1.83 |
| **Train + validation** | **30** | 30.0 % | **−0.346 [−0.836, +0.229]** | −0.033 | **0.63** | −10.39 |

Perturbation (±10 % on `minSignalConfidence`, `minRiskReward`, `volumeConfirmMult`, `maxStopAtr`, `zoneClusterPct`, `atrStopBufferMult`; 12 perturbed variants + default): **every variant has negative mean net R (−0.16 … −0.44) and PF 0.53–0.80** on the decision range. No robustness cliff — but no positive region either. Slices (decision range): long −0.29 R (n = 18), short −0.43 (12); low-vol −0.59 (12), mid −0.40 (7), high-vol −0.05 (11).

`EXIT_SUGGESTED`: 17 of the 30 trades got one; closing at the suggestion would have averaged −0.40 R vs −0.70 R realised (better in 14/17).

### 9.2 Smart Alerts presets — 4 h horizon (confirmation = 1 step)

| Preset (claimed bias) | fires | n_indep | mean gross | baseline | excess net [95 % CI] | 1 h excess net |
|---|---|---|---|---|---|---|
| reversal_watch (bullish) | 22 | 19 | +0.078 % | +0.028 % | −0.071 % [−0.665, +0.607] | −0.155 % [−0.531, +0.191] |
| strong_momentum (bullish) | 174 | 154 | +0.114 % | +0.028 % | −0.034 % [−0.240, +0.176] | −0.138 % [−0.268, **−0.004**] |
| overheated_market (bearish) | 30 | 26 | +0.133 % | −0.028 % | +0.041 % [−0.455, +0.552] | −0.323 % [−0.589, **−0.094**] |
| long_squeeze_watch / short_squeeze_watch | **0** | — | cannot fire | | | |

Note the 1 h row for `overheated_market`: mean gross −0.21 %, i.e. after the alert BTC went **up** 0.21 % in the next hour on average (n = 30, CI excludes 0 net of costs) — the opposite of its "🔴 bias ribassista" claim at that horizon; at the primary 4 h horizon it is indistinguishable from zero.

**Ablation** (excess net at 4 h; every subset of each preset's conditions): no subset has a positive excess whose CI excludes zero, and the full AND always has among the fewest events. The best-looking subsets are `reversal_watch` OI + funding (+0.135 % [−0.185, +0.440], 63 fires) and `overheated_market` OI + funding (+0.049 % [−0.144, +0.247], 189 fires) — both CIs span zero. Examples (decision range): `reversal_watch` price alone n = 30,283 fires, excess −0.098 % [−0.110, −0.086]; price+OI 162 fires, −0.263 %; the full 3-way 22 fires, −0.071 %. `strong_momentum`: price alone −0.129 % [−0.143, −0.115] (n = 18,026); volume alone −0.120 %; price+OI −0.029 % (238); all three −0.034 % (174). `overheated_market`: RSI alone −0.096 % [−0.141, −0.050] (1,955); funding alone −0.119 % (17,188); all three +0.041 % (30). *Adding conditions shrinks the sample; it does not add measurable information.*

**Threshold sensitivity (±10 %)**: `strong_momentum` is stable (174 → 170–176 fires except OI ×0.9/×1.1: 241/144; 4 h excess −0.018 … −0.055 %). `reversal_watch`: 20–27 fires, excess −0.056 … −0.128 %. **`overheated_market` is fragile in event count**: funding 0.009 → 30 fires, 0.011 → **5**; RSI 72 → 55, 88 → 8 (the funding threshold sits on Binance's 0.01 % plateau).

**Confirmation 2 steps vs 1**: fires 22→18 / 174→142 / 30→25; 4 h excess −0.248 % / +0.055 % / −0.071 %.

**Invalidation logic (defect found, fixed)**: with the preset default of 2 cycles, an unconfirmed one-cycle blip announced an "invalidated" event whenever the alert had ever fired: 3 of 21 (`reversal_watch`), **32 of 174** (`strong_momentum`), 5 of 29 (`overheated_market`) invalidation pushes referred to a streak the user was never notified about; at 3 cycles 146 of 172 for `strong_momentum`. Also, because each fire is followed by an invalidation, the push count is ≈ 2 × fires (38/38, 215/214, 30/29).

### 9.3 Price × OI quadrants, funding buckets, volume (descriptive)

* Quadrants and funding buckets: `PARAMETER_AUDIT.md` §B, §C — nothing moves forward returns by more than ~0.06 % at 4 h.
* **Volume study** (asked for in review; `volumeStudy.ts`, spot 1h, relative volume vs previous 24 bars × taker-buy share): 12 cells × 3 horizons = 36 tests on the decision range; **2** had a 95 % CI excluding zero (expected by chance ≈ 1.8): "RV 0.8–1.5, sell-dominated, 4 h": +0.038 % [0.000, +0.076]; "RV 0.8–1.5, buy-dominated, 1 h": −0.023 %. Largest |excess| of any cell ≤ 0.16 %, typical < 0.05 %. Out of sample the first repeats its sign (+0.065 % [−0.007, +0.139]) but is far below the 0.12 % cost; the second flips sign (+0.012 %). Volume spikes (RV ≥ 2.5) with buy- or sell-dominated taker flow: |excess| ≤ 0.13 % at 4 h in both periods, CIs straddling 0. **Volume does not carry a tradable directional signal on these horizons.**

### 9.4 Dashboard BUY/SELL score (entry into the state; 4 h primary; gross vs same-direction baseline)

| Pipeline | Signal | n | n_indep | mean gross | excess gross | excess net [95 % CI] |
|---|---|---|---|---|---|---|
| Faithful (with the two data bugs) | BUY | 166 | 165 | +0.012 % | −0.017 % | −0.137 % [−0.287, +0.018] |
| | SELL | 132 | 125 | +0.025 % | +0.053 % | −0.067 % [−0.254, +0.120] |
| Corrected | BUY | 156 | 156 | +0.008 % | −0.020 % | −0.140 % [−0.296, +0.007] |
| | SELL | 135 | 134 | −0.033 % | −0.005 % | −0.125 % [−0.276, +0.039] |

The bugs change counts by ~1 % (196/173 vs 194/172 entries) and nothing in the 4 h outcome. At 24 h–3 d the excess gross of BUY/SELL is positive (+0.13 … +0.52 %) with CIs that include 0 — the state persists for days, so a longer-horizon claim is plausible but is not what the badge promises and was not pre-declared.

## 10. Out-of-sample results (2026-01-24 → 2026-08-31; unblinded once)

| Signal | n | n_indep | mean gross 4h | excess net 4h [95 % CI] | Verdict vs decision range |
|---|---|---|---|---|---|
| Scalp ENTRY_CONFIRMED | 13 | 12 | +0.312 % | +0.194 % [−0.174, +0.616] | **contradicts** (sign flips) but n = 13 |
| Scalp SETUP_DETECTED | 141 | 119 | +0.049 % | −0.070 % [−0.233, +0.112] | consistent (≈ 0 gross) |
| Scalp SETUP_INVALIDATED | 132 | 118 | +0.103 % | −0.016 % [−0.148, +0.125] | consistent |
| Scalp paper trades | 13 | — | mean net R **+0.358** [−0.582, +1.239], PF 1.59, win 53.8 % | | contradicts |
| All 43 trades (3 y) | 43 | — | mean net R **−0.133**, PF 0.84, total −5.73 R | | |
| Smart reversal_watch | 16 | 12 | −0.159 % | −0.274 % [−0.604, +0.039] | consistent, tiny n |
| Smart strong_momentum | 41 | 33 | +0.115 % | 0.000 % [−0.475, +0.507] | consistent (≈ 0 net) |
| Smart overheated_market | **0** | — | — | — | **did not fire in 7 months** |
| Dashboard BUY (faithful / corrected) | 30 / 38 | 30 / 38 | −0.076 % / +0.038 % | −0.190 % / −0.077 % | consistent |
| Dashboard SELL (faithful / corrected) | 41 / 37 | 41 / 37 | −0.192 % / +0.075 % | −0.317 % [−0.598, −0.052] / −0.045 % | mixed |

The OOS positive scalp result (13 trades) does **not** rescue the engine: its CI spans −0.58…+1.24 R, the pooled 43-trade expectancy is negative, all 12 perturbations on the pooled 43 trades stay negative (−0.07 … −0.24 R, PF 0.72–0.91), and the live system was not running this closed-candle logic (§8). It does mean the decision-range evidence against the engine is **not** conclusive.

## 11. Regime analysis

* Scalp regime share: neutral 60.6 %, bullish 23.2 %, bearish 16.2 % of bars — the engine is designed to be flat most of the time.
* Scalp trades by volatility tercile (train-fitted cuts 0.187 % / 0.257 % per-15m stdev), all 43 trades: **low-vol −0.22 R (21)**, mid −0.50 R (8), **high-vol +0.21 R (14)**; decision range: −0.59 / −0.40 / −0.05. Direction: long −0.21 R (27) vs short 0.00 R (16). Confidence score: `< 70` −0.35 R (33 trades), `70–79` +0.45 R (9), `≥ 80` +1.82 R (1). These are observational slices of a 43-trade sample (not corrected for multiple looks) — they are hypotheses, not findings.
* Smart Alerts, 4 h excess net by 4h-trend regime / volatility (decision range): `strong_momentum` bullish −0.116 % (54), bearish +0.338 % (15), range −0.045 % (105), low-vol −0.056 %, mid −0.139 %, high-vol +0.051 %; `reversal_watch` fired **0 times in a bullish regime**, bearish −0.546 % (9), range +0.258 % (13); `overheated_market` fired mostly in a *bullish* regime (13 of 30, +0.249 %). Slices were computed on the pooled decision range only; every slice has n < 60 except `strong_momentum`'s (n = 15–105), so none can support a regime-specific claim.

## 12. Weak signals

Classified WEAK (pooled gross excess > 0, CI includes 0): Scalp `SETUP_DETECTED`, `SETUP_INVALIDATED`, Smart `strong_momentum`, Dashboard SELL (faithful). See `SIGNAL_RELIABILITY.md`.

## 13. Unreliable signals

Classified UNRELIABLE (n_indep ≥ 30 and pooled gross excess ≤ 0 at 4 h): Scalp `ENTRY_CONFIRMED` (decision range; contradicted by a 13-trade OOS), Dashboard BUY (both pipelines) and Dashboard SELL (corrected).

INSUFFICIENT DATA: Smart `reversal_watch` (n_indep 19; OOS 12), `overheated_market` (26; OOS 0), the two liquidation presets (cannot fire), `EXIT_SUGGESTED`/`STOP_HIT`/`TP*_HIT` (outcomes of the trade lifecycle, not independent predictions).

## 14. Signals removed / disabled

None **for performance**: no signal met all three removal criteria of `PRE_REGISTRATION.md` (UNRELIABLE, never positive under perturbation, not contradicted OOS). Disabled for **defects**, independent of returns: the *push* of `SETUP_INVALIDATED`; the two liquidation presets in the preset grid. Details and before/after: `REMOVED_SIGNALS.md`, `CHANGELOG_SIGNAL_ENGINE.md`.

## 15. Signals retained

`ENTRY_CONFIRMED`, `EXIT_SUGGESTED`, `STOP_HIT`, `TP1_HIT`, `TP2_HIT`, `SETUP_DETECTED` (history only), `SETUP_INVALIDATED` (history only), `reversal_watch`, `strong_momentum`, `overheated_market`, custom Smart Alerts, dashboard BUY/SELL badge. Retained means "still emitted", **not** "validated": none is RELIABLE or CONDITIONALLY RELIABLE.

## 16. Remaining limitations

1. **Statistical power.** 43 scalp trades in three years cannot separate "no edge" from a modest edge; the CIs are ±0.8 R wide. `reversal_watch`/`overheated_market` have < 30 independent events.
2. **One instrument, one 3-year path** dominated by a few large trends; results may not transfer to other regimes. 60 % of scalp bars are "neutral".
3. **Data not in the archive** (order book, liquidations, mark/index) cannot be studied; the Smart Alert replay reproduces the documented OI publication lag from a live spot-check, not from a historical record.
4. **Smart Alerts cadence** is approximated at 5 minutes (live: 1 minute on data that refresh every 5–15 min); the live 2-cycle confirmation is treated as 1 step.
5. **Repaint study** = two 122-day windows (24 live-like entries); the second window lies entirely in the OOS range and was not used for any decision.
6. **Multiple comparisons**: many slices and horizons were examined; only pre-declared items (4 h, decision range, five classes) drive classification.
7. **Costs** are the engine's own assumption (futures fee tier on a spot-priced engine, fixed spread/slippage); real fills in volatile minutes are worse.
8. Three Edge functions (`signal-cycle`, `smart-alerts-cycle`, `push-subscribe`) were edited but **not deployed** from this session; live behaviour changes only after `supabase functions deploy`.

## How to reproduce

```bash
npx tsx scripts/audit/download.ts                     # ~300 MB cache in .audit-cache (git-ignored)
npx tsx scripts/audit/dataQuality.ts
npx tsx scripts/audit/runScalpAudit.ts                # decision range only (OOS withheld)
npx tsx scripts/audit/runSmartAudit.ts
npx tsx scripts/audit/runLegacyAudit.ts
npx tsx scripts/audit/volumeStudy.ts
npx tsx scripts/audit/repaintStudy.ts --from=2025-09 --to=2025-12 --mode=forming   # before the fix
npx tsx scripts/audit/repaintStudy.ts --from=2025-09 --to=2025-12 --mode=closed    # after the fix
npx tsx scripts/audit/runScalpAudit.ts --oos          # (and the other runners) — unblinds OOS
npx vitest run                                        # unit + no-look-ahead + determinism tests
```
Raw outputs: `docs/audit/data/*.md|json`.
