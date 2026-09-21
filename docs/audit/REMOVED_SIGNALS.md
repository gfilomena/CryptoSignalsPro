# REMOVED_SIGNALS — what was disabled, what was deliberately *not* removed, and why

Date of change: **2026-09-21** (branch `audit/signal-engine`). Nothing was removed silently and no threshold was retuned.
Rules: `PRE_REGISTRATION.md`. A signal is removed **for performance** only if UNRELIABLE, never positive under ±10 %
perturbation, and not contradicted out of sample. **No signal met all three.** The two items below were disabled for
**defects** (logic/data), which does not depend on returns.

## 1. Scalp `SETUP_INVALIDATED` — push notification disabled (event still recorded in history)

| Field | Value |
|---|---|
| Original logic | State goes `LONG_SETUP`/`SHORT_SETUP`/`*_CONFIRMED` → `EXPIRED` ⇒ alert; listed in `PUSH_ALERT_TYPES` (client + `signal-cycle`), in `ALL_ALERT_TYPES` (user toggles) and in the `push-subscribe` default |
| Why | It can only follow a setup, and **`SETUP_DETECTED` is never pushed by design**. So the user received "setup invalidated" for setups they had never been told about. Replay: **535 of 535** invalidations followed an unpushed `SETUP_DETECTED` (0 followed a confirmed entry); they are **82.7 %** of all scalp push-eligible events (0.51 of 0.62/day). Median setup life is 9 bars of 15 min (p25 = 8): mostly the 8-bar pullback window rolling past the zone touch, i.e. a **time expiry, not a market invalidation**. Live-like (forming candle) rate: 1.3/day |
| Historical performance | Direction-adjusted 4 h excess gross +0.050 % [−0.030, +0.133] (WEAK — no directional information); OOS +0.10 % gross, −0.02 % net |
| False-positive rate | 100 % by construction (every push referred to a setup the user was not told about) |
| Replacement | None needed: trade-affecting events keep their own alerts (`ENTRY_CONFIRMED`, `EXIT_SUGGESTED`, `STOP_HIT`, `TP1_HIT`, `TP2_HIT`). `SETUP_INVALIDATED` remains in `scalp_alerts` / the Signal History panel |
| Change | `PUSH_ALERT_TYPES`, `ALL_ALERT_TYPES`, `signal-cycle`, `push-subscribe` default. Existing subscriptions that stored the type are harmless (the server filters by `PUSH_ALERT_TYPES`) |
| Before → after | Scalp pushes/day (3-year replay): **0.619 → 0.107** (−83 %) |
| Reversible? | Yes: add the type back to the four lists; a unit test pins that the user-facing list equals the server list |

## 2. Smart Alerts presets `long_squeeze_watch` and `short_squeeze_watch` — hidden from the preset grid

| Field | Value |
|---|---|
| Original logic | 24h price ≤ −0.5 % (≥ +0.5 %) AND long (short) liquidations ≥ $5 M AND OI(15m) ≤ −1 % |
| Why | Liquidation metrics are **always `null`** (no public Binance aggregate endpoint; no historical archive); an AND with an unavailable condition fails closed. **0 fires in 315,360 five-minute steps** — they can never fire, yet were offered as if they monitored something |
| Historical performance | none possible — INSUFFICIENT DATA. *This is not a small-sample removal:* the sample is zero because the signal is structurally impossible |
| False-positive rate | n/a (0 alerts) |
| Replacement | none; definitions stay in `PRESET_DEFINITIONS` (stored alerts keep working; `getPreset` unchanged) and reappear automatically once `UNAVAILABLE_METRICS` no longer lists the liquidation metrics |
| Change | `AVAILABLE_PRESETS` (new) used by `PresetGrid`; `UNAVAILABLE_METRICS` moved to the pure `metricDefs.ts` |

## 3. Considered and **not** removed (the honest list)

| Signal | Evidence against it | Why it stays |
|---|---|---|
| Scalp `ENTRY_CONFIRMED` | UNRELIABLE on the decision range: 30 trades, −0.35 R net, PF 0.63, all 12 perturbations negative | CI includes zero (−0.84…+0.23 R); OOS 13 trades +0.36 R contradicts; pooled 43 trades −0.13 R. The frozen rule requires *not contradicted OOS*. It is also the only signal whose live behaviour differed from its backtest — fixing the repainting was the necessary step; whether the fixed engine should keep pushing trades is a **decision for you** (see the final report) |
| Dashboard BUY / SELL badge | UNRELIABLE / WEAK at 4 h | No perturbation test was run on the score's thresholds (rule not met); the badge is display-only (no push); longer horizons (24 h–3 d) show a positive but non-significant excess. Candidate for relabelling rather than removal |
| Smart `overheated_market` | INSUFFICIENT DATA, dormant for 7 months, 1 h outcome opposite to its claim | < 30 independent events (rule forbids removal for small samples). Flagged in the changelog |
| Smart `reversal_watch`, `strong_momentum` | INSUFFICIENT DATA / WEAK | same |
| Push-title bias labels ("🟢 Bias rialzista" / "🔴 Bias ribassista") | Not supported by the replay at any horizon tested | Copy/product decision, not a data defect; left unchanged and reported |

## 4. Unchanged limitations noticed but not addressed (out of the "necessary fixes" scope)

RSI is the simple-average variant (RSI ≥ 80 occurs 4.3× more often than Wilder's); `funding ≥ 0.01` equals Binance's neutral clamp; `PRICE_CHANGE` is a 24h rolling change labelled "Price change %"; `funding`/`OI` are staler than price. See `PARAMETER_AUDIT.md`. Changing any of these would change signal semantics and needs its own evidence and a fresh out-of-sample period.
