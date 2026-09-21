# CHANGELOG_SIGNAL_ENGINE — every change, the evidence behind it, and before/after

Branch `audit/signal-engine` (base: `main` @ `616aad5`). Date: 2026-09-21. No thresholds changed.

## Changes

| # | Change | Files | Evidence | Type |
|---|---|---|---|---|
| 1 | **Scalp engine evaluates closed candles only**; the forming candle's last price is kept only to monitor an open trade's SL/TP | `src/lib/scalp/klines.ts` (`closedCandles`), `signalClient.ts`, `supabase/functions/signal-cycle/index.ts` | Live evaluated the forming candle of all 3 timeframes every minute; backtest only closed ones. Live-like replay: **2.2–2.75× more entries, 3.2–3.7× more setup/invalidation alerts, only 36–38 % of intrabar entries valid at the close** (two 122-day windows). After: counts match the backtest (53/5/50 vs 53/4/50; 70/6/64 vs 69/6/63) | Bug (backtest ≠ live) |
| 2 | **`SETUP_INVALIDATED` no longer pushed** (still in history) | `strategyConfig.ts`, `pushClient.ts`, `signal-cycle`, `push-subscribe` | 535/535 follow an unpushed setup; 83 % of scalp pushes; mostly window expiry — `REMOVED_SIGNALS.md` §1 | Logic defect |
| 3 | **Smart Alert invalidation requires a confirmed streak** (`prevPending ≥ confirmationCycles`) | `conditionEngine.ts`, `smart-alerts-cycle` | Previously any pending count > 0 + a past fire qualified: with the preset default of 2 cycles, 3/21, 32/174, 5/29 invalidation pushes referred to a streak never notified (146/172 at 3 cycles) | Logic defect |
| 4 | **Liquidation presets hidden** (cannot fire) | `presets.ts` (`AVAILABLE_PRESETS`), `PresetGrid.tsx`, `metricDefs.ts`, `marketData.ts` (re-export) | 0 fires in 315,360 steps — `REMOVED_SIGNALS.md` §2 | Defect (unreachable) |
| 5 | **Dashboard signal inputs fixed**: forming 4h candle no longer double-counted; OBV uses 4h volumes only (was mixed with the 24h volume) | `src/lib/marketData.ts` | Code inspection + replay: faithful vs corrected pipelines; entries 196/173 → 194/172 | Data bug |
| 6 | Audit harness, downloader, replay, statistics, studies | `scripts/audit/*`, `docs/audit/*`, `.gitignore` | — | New (no runtime impact) |

## Before / after

| Metric | Before | After |
|---|---|---|
| Scalp push events per day (3-year closed replay) | 0.619 | **0.107** (−83 %) |
| Live-like setup alerts (SETUP_DETECTED) / 122 d, window A · B | 169 · 253 | **53 · 70** |
| Live-like ENTRY_CONFIRMED / 122 d, A · B | 11 · 13 | **5 · 6** |
| Live-like SETUP_INVALIDATED / 122 d, A · B | 158 · 240 | **50 · 64** |
| Live-like paper trades net R, A · B (small n) | −6.00 R (11) · −5.39 R (13) | **−0.20 R (5) · −2.33 R (6)** |
| Smart invalidation pushes, decision range, 2 cycles (rev / mom / hot) | 21 / 174 / 29 (orphan 3 / 32 / 5) | **18 / 142 / 24 (orphan 0)** |
| Presets offered | 5 (2 can never fire) | **3** |
| Dashboard BUY / SELL entries (36 mo) | 196 / 173 | 194 / 172 |
| Unit tests | 133 | **175** (adds: closed-candle filter, push-list sync, invalidation rule, preset availability, dashboard inputs, replay determinism, truncation invariance, future poisoning, harness statistics) |

Expectancy is **not** claimed to improve: the after-fix engine is the *same strategy* that the audit found to have no demonstrated edge; the fix makes live behaviour equal to what was measured.

## Tests

`npx vitest run` → 22 files, 175 tests pass. `npx tsc -b` clean. ESLint: the same 13 pre-existing problems before and after (none in changed lines). The two audit runners produce **byte-identical** JSON on two independent runs.

## Deployment (not done from this session)

The client changes ship with the next web deploy. **Three Edge functions must be redeployed** for the server side to change: `signal-cycle`, `smart-alerts-cycle`, `push-subscribe`. Until then the server keeps the old behaviour (forming candles, invalidation pushes).

## Open decisions for the owner

1. Keep pushing `ENTRY_CONFIRMED` (UNRELIABLE on the decision range, inconclusive out of sample)? Options: keep as paper-only "research" signal, or push with an explicit "no demonstrated edge" disclaimer.
2. Push-title bias labels ("Bias rialzista/ribassista") are not supported by the replay.
3. Dashboard BUY/SELL badge wording (no 4 h information).
4. Whether to re-base thresholds (RSI variant, funding plateau, 24h vs short-term price change) — needs a new out-of-sample period.
