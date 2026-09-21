// Market Setup Analyzer — configuration. Everything a statistician could be tempted to "tune" lives here, in one
// place, with the reason it has the value it has. None of these numbers was chosen by looking at outcomes.
export const BAR_MS = 300_000 // 5-minute bars: the finest grid all features can be computed on (OI resolution)

export interface HorizonDef { label: string; bars: number }
/** Forward horizons. The first five are the ones the UI leads with (spec §13); 12h/24h are stored and shown on demand. */
export const HORIZONS: HorizonDef[] = [
  { label: '5m', bars: 1 }, { label: '15m', bars: 3 }, { label: '30m', bars: 6 }, { label: '1h', bars: 12 },
  { label: '4h', bars: 48 }, { label: '12h', bars: 144 }, { label: '24h', bars: 288 },
]
export const MAIN_HORIZONS = ['5m', '15m', '30m', '1h', '4h'] as const
/** Horizons that decide the bias/strength (fixed a priori, mirroring the signal-engine audit's 30m–4h focus). */
export const BIAS_HORIZONS = ['30m', '1h', '4h'] as const
export const MAX_HORIZON_BARS = 288

export interface AnalyzerConfig {
  /** Distance threshold τ0 (RMS group-z distance). Calibrated OUTCOME-FREE on train rows only — see scripts/analyzer/buildStore.ts. */
  thresholdBase: number
  /** Robustness multipliers applied to τ0 (spec §17: 0.8, 0.9, 1.0, 1.1). */
  thresholdMultipliers: number[]
  /** Sample-size classes on the EFFECTIVE (de-clustered) N. Configurable (spec §9). */
  minSample: { low: number; moderate: number; strong: number }
  /** Restrict analogs to the last N days of the store (null = whole store). */
  windowDays: number | null
  /** Minimum separation gap between two counted analogs, in minutes (de-clustering floor; the horizon itself is used when larger). */
  minGapMinutes: number
  /** Wilson interval z (1.96 = 95 %). */
  z: number
  /** Presentation bins for the "setup confirmation" label on the 0–100 strength (not a probability). */
  confirmationBins: { strong: number; moderate: number; weak: number }
  /** Per-group "match quality" bins on the analogs' RMS z-gap (lower = closer). */
  matchBins: { high: number; moderate: number }
}

export const DEFAULT_CONFIG: AnalyzerConfig = {
  thresholdBase: 1.0, // overwritten by the value stored with the feature store (store.meta.thresholdBase)
  thresholdMultipliers: [0.8, 0.9, 1.0, 1.1],
  minSample: { low: 30, moderate: 100, strong: 300 },
  windowDays: null,
  minGapMinutes: 60,
  z: 1.96,
  confirmationBins: { strong: 60, moderate: 40, weak: 20 },
  matchBins: { high: 0.5, moderate: 1.0 },
}

/** Returns above/below these levels are what the probability table reports (spec §8). */
export const RETURN_LEVELS = [0.0025, 0.005, 0.01]

// ---- feature-construction constants (used identically by the offline store builder and the live snapshot) ----
/** Trailing window for volume / volatility baselines: 3 days of 5-minute bars. */
export const BASELINE_BARS = 864
/** OI history is published with a lag; both history and live use the latest 5-min boundary at least this old. */
export const OI_LAG_MS = 600_000
/** Trailing funding settlements used for the funding percentile (90 days at 8 h). */
export const FUNDING_PCT_WINDOW = 270
export const FUNDING_PCT_MIN = 90
/** Rolling 24 h window (288 bars) for the intraday high/low distance. */
export const RANGE_BARS = 288
export const MIN_BAR_INDEX = BASELINE_BARS + 12
