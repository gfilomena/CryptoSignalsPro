# SIGNAL_RELIABILITY — classification of every signal

Rules are those of `PRE_REGISTRATION.md` (frozen before the OOS was unblinded). Only five classes are used.
Primary horizon 4 h; decision range = 2023-09-01 → 2026-01-24; OOS = 2026-01-24 → 2026-08-31.
"Excess gross" = mean direction-adjusted return − unconditional same-direction mean, before the 0.12 % round-trip cost
(CI = net CI shifted by +0.12 %). **No class means "predicts the future"; RELIABLE and CONDITIONALLY RELIABLE are empty.**

| Signal | n_indep (4h) | Excess gross 4h [95 % CI] | Class | Why |
|---|---|---|---|---|
| Scalp **ENTRY_CONFIRMED** | 30 | −0.242 % [−0.665, +0.169] | **UNRELIABLE** | No information even before costs on the decision range; engine trades: 30, win 30 %, mean net R −0.35 (gross −0.03), PF 0.63; **all 12** ±10 % perturbations stay negative (−0.16 … −0.44 R). *Caveats that matter:* CI spans zero; OOS (13 trades) is positive (+0.36 R, PF 1.59, CI −0.58…+1.24) so the removal rule is **not** met; pooled 43 trades −0.13 R/PF 0.84; and live never ran this logic (repainting, §8 of the report). Read as "no demonstrated edge, negative point estimate, not statistically conclusive" |
| Scalp SETUP_DETECTED (history only) | 369 | +0.004 % [−0.087, +0.096] | **WEAK** | Gross return equals the drift baseline; net −0.12 % at 15m–1h = cost. Informational, never pushed |
| Scalp SETUP_INVALIDATED (history only after fix) | 364 | +0.050 % [−0.030, +0.133] | **WEAK** | Forward return after "invalidation" is not measurably different from baseline — the event carries no information about direction. The real problem was a logic defect (535/535 orphan pushes), see `REMOVED_SIGNALS.md` |
| Scalp EXIT_SUGGESTED | 26 events (all data) | n/a | INSUFFICIENT DATA | 26 events. Descriptively, exiting at the suggestion beat the engine's own exit in 19/26 (decision range 14/17) but mean R is negative either way (−0.44 vs −0.41 R overall) |
| Scalp STOP_HIT / TP1_HIT / TP2_HIT | 27 / 13 / 3 | n/a | INSUFFICIENT DATA | Outcome notifications of a trade lifecycle, not predictions; evaluated through the trade statistics |
| Smart **reversal_watch** | 19 (OOS 12) | +0.049 % [−0.545, +0.727] | INSUFFICIENT DATA | 38 fires in 3 years; < 30 independent events in the decision range; OOS 4 h excess −0.27 % [−0.60, +0.04]. The 3-way AND leaves almost no sample; price and funding conditions are true 35 %/11 % of the time and add no information |
| Smart **strong_momentum** | 154 (OOS 33) | +0.086 % [−0.120, +0.296] | **WEAK** | Point estimate slightly positive, indistinguishable from noise; net ≈ 0 at 4 h (−0.034 %, OOS 0.000 %), negative at 1 h (−0.138 % [−0.268, −0.004]); sign of the 4 h gross excess flips between train (+0.12 %) and validation (−0.11 %). ±10 % thresholds are stable |
| Smart **overheated_market** | 26 (OOS 0) | +0.161 % [−0.335, +0.672] | INSUFFICIENT DATA | 30 fires (27 train, 3 validation, **0 in the last 7 months**); at 1 h BTC rose 0.21 % on average after the alert (against the claimed bearish bias, CI excludes 0 net). Threshold fragile: funding 0.009→0.011 cuts fires 30→5 (sits on Binance's 0.01 % plateau) |
| Smart long_squeeze_watch / short_squeeze_watch | 0 | — | INSUFFICIENT DATA | Cannot fire: liquidation data does not exist in the app or the historical archive. 0 fires in 315,360 steps |
| Smart CUSTOM alerts | — | — | INSUFFICIENT DATA | User-defined; the ablation shows the individual metrics (price/OI/funding/volume/RSI) carry no measurable forward information |
| Dashboard **BUY** badge | 165 (faithful) / 156 (corrected) | −0.017 % [−0.167, +0.138] / −0.020 % [−0.176, +0.127] | **UNRELIABLE** | No 4 h information; OOS 4 h excess net −0.19 % / −0.08 %. At 24 h–3 d the excess gross is positive (+0.13 … +0.51 %) with CIs spanning 0 — a longer-horizon claim is plausible but was not pre-declared |
| Dashboard **SELL** badge | 125 (faithful) / 134 (corrected) | +0.053 % [−0.134, +0.240] / −0.005 % [−0.156, +0.159] | WEAK (faithful) / UNRELIABLE (corrected) | The two classes differ by 0.06 % — well inside the noise; read both as "no measurable 4 h edge". OOS SELL (faithful) 4 h net −0.32 % [−0.60, −0.05] |

## Reading guide

* **Why so few signals are classified with confidence:** the engines are *selective by design* (ENTRY_CONFIRMED 0.04/day; `overheated_market` 0.03/day). Selectivity is good for alert fatigue and bad for statistics: three years give 43 trades. A signal cannot be called reliable *or* refuted at that sample size, which is why the class INSUFFICIENT DATA is populated and the removal rule demands more than a negative point estimate.
* **What the data do support:** (1) none of the *inputs* tested — price×OI quadrants, funding buckets, volume/taker imbalance, OI change, RSI(1h) ≥ 80 — shifts 4 h forward returns by more than a few hundredths of a percent, ~one third of the round-trip cost; (2) combining them with AND shrinks the sample without adding measurable information; (3) after costs, at horizons ≤ 1 h every alert is negative by roughly the cost itself.
* **What the data do not support:** any statement that these alerts *identify* reversals, overheating or momentum. The push-title bias labels ("🟢 Bias rialzista", "🔴 Bias ribassista") are not backed by the replay; they are kept unchanged pending your decision (see the final report).
