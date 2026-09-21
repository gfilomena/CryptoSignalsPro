# Pre-registration of classification rules (frozen before the out-of-sample unblinding)

Committed **before** `--oos` was ever passed to `runScalpAudit.ts`, `runSmartAudit.ts` or `runLegacyAudit.ts`.
Anything decided from this point on uses the *decision range* only (train 2023-09-01→2025-06-20 + validation
2025-06-20→2026-01-25). The OOS range (2026-01-25→2026-09-01, 20 %) is a one-shot confirmation and is reported
as-is, whatever it shows.

**Disclosure (honesty about contamination):** a smoke run of the scalp replay, executed while building the harness,
printed event *counts* per split and the aggregate net R over all splits (including OOS). No threshold, rule or
classification was derived from it; the split boundaries (60/20/20 by time) were fixed before, and no parameter of
the engine was tuned at all (this is an audit of the shipped defaults).

## Unit of evaluation
* Direction-adjusted forward return from the signal-bar close (the information set ends at that close), net of the
  engine's own cost model: 2×0.04 % fee + 0.02 % spread + 0.02 % slippage = **0.12 % round trip**.
* "Excess" = return − unconditional mean return of the same direction over the same range and horizon (removes BTC drift).
* 95 % CI = seeded percentile bootstrap (B = 2000, seed 12345). Overlap is handled by reporting `n_indep`
  (greedy de-clustering, events ≥ horizon apart).
* **Primary horizon (fixed a priori): 4 h** for every "bias" alert; for the scalp `ENTRY_CONFIRMED` the engine's own
  trade outcome (net R, its own SL/TP) is primary and 4 h is secondary. Other horizons are descriptive.
* Direction hypothesis = what the alert itself claims (long/short of the setup; `directionLabel()` for Smart Alerts).

## Classes (only these five)
| Class | Rule (decision range, primary horizon) |
|---|---|
| INSUFFICIENT DATA | `n_indep` < 30, **or** the signal cannot fire (missing data source). Never removed for this reason alone. |
| UNRELIABLE | `n_indep` ≥ 30 **and** pooled excess **gross** ≤ 0 (no information even before costs) |
| WEAK | pooled excess gross > 0 but its 95 % CI includes 0 (indistinguishable from noise) |
| CONDITIONALLY RELIABLE | pooled excess gross CI lower bound > 0, but excess **net** CI lower bound ≤ 0, or the edge appears only in identifiable regime slices consistently in both train and validation |
| RELIABLE | pooled excess **net** CI lower bound > 0, train and validation both > 0, and OOS point estimate > 0 |

## Action rules
* A signal is **removed/disabled for performance** only if it is UNRELIABLE *and* the perturbation test (±10 % on each
  threshold) never yields a positive net expectancy *and* the OOS point estimate does not contradict it.
* A signal is **fixed** (not removed) when the audit shows a logic/data defect, independent of its returns.
* Thresholds are **never** retuned in this audit.
* Everything removed/changed is listed in `REMOVED_SIGNALS.md` / `CHANGELOG_SIGNAL_ENGINE.md`.
