// Market-state vector. ONE function (`featureVector`) computes it for a historical bar and for the live snapshot, so the
// two can never drift apart. Everything is computed from data that was available at the observation time T (the CLOSE of
// 5-minute bar i): bars <= i, OI published >= OI_LAG_MS before T, the last SETTLED funding rate, closed 4h candles <= T.
import { BAR_MS, BASELINE_BARS, FUNDING_PCT_MIN, FUNDING_PCT_WINDOW, MIN_BAR_INDEX, OI_LAG_MS, RANGE_BARS } from './config'
import { detectRegime } from '../scalp/regime'
import { DEFAULT_STRATEGY_CONFIG } from '../../config/strategyConfig'
import type { Candle } from '../../types/scalpSignal'

export type FeatureGroup = 'PRICE' | 'OI' | 'FUNDING' | 'VOLUME' | 'VOLATILITY' | 'POSITION' | 'REGIME'

export interface FeatureDef {
  name: string
  group: FeatureGroup
  /** true: robust-z scaled; false: used as is (categorical regime) */
  scaled: boolean
}

const g = (group: FeatureGroup, names: string[], scaled = true): FeatureDef[] => names.map((name) => ({ name, group, scaled }))

/**
 * The final market-state vector (22 features in 7 groups). Only parameters that exist in the application AND in the
 * historical archive are used; liquidations, mark/index price and order-book data are NOT in the vector (no history).
 */
export const FEATURES: FeatureDef[] = [
  ...g('PRICE', ['ret_5m', 'ret_15m', 'ret_30m', 'ret_1h', 'ret_4h', 'ret_24h']), //   % change of the futures close
  ...g('OI', ['oi_5m', 'oi_15m', 'oi_30m', 'oi_1h', 'oi_4h', 'oi_24h']), //          % change of open interest
  ...g('FUNDING', ['funding_rate', 'funding_pct']), //                               last settled rate (%), percentile vs 90 d
  ...g('VOLUME', ['vr_5m', 'vr_15m', 'vr_30m', 'vr_1h']), //                         ln(window volume / trailing-3d average window volume)
  ...g('VOLATILITY', ['vol_ratio']), //                                              ln(1h realised vol / trailing-3d average)
  ...g('POSITION', ['dist_high_24h', 'dist_low_24h']), //                            % below the 24h high / above the 24h low
  ...g('REGIME', ['trend_4h'], false), //                                            -1 downtrend, 0 range, +1 uptrend (4h EMA + structure)
]
export const FEATURE_NAMES = FEATURES.map((f) => f.name)
export const FEATURE_GROUPS: FeatureGroup[] = ['PRICE', 'OI', 'FUNDING', 'VOLUME', 'VOLATILITY', 'POSITION', 'REGIME']
export const featureIndex = (name: string): number => FEATURE_NAMES.indexOf(name)

const STEPS = { '5m': 1, '15m': 3, '30m': 6, '1h': 12, '4h': 48, '24h': 288 } as const

export interface FundingPoint { t: number; /** percent, e.g. 0.01 = 0.01 % */ rate: number }
export type OiLookup = (tMs: number) => number | undefined

export interface BarsInput { t: ArrayLike<number>; h: ArrayLike<number>; l: ArrayLike<number>; c: ArrayLike<number>; v: ArrayLike<number> }

export interface Series extends BarsInput {
  n: number
  /** 12-bar realised volatility of log returns at each bar (NaN for the first 12 bars) */
  rv12: Float64Array
  /** prefix sums (length n+1) of volume and of rv12 (NaN counted as 0) */
  cumV: Float64Array
  cumRv: Float64Array
}

export function prepareSeries(b: BarsInput): Series {
  const n = b.c.length
  const lr = new Float64Array(n)
  for (let i = 1; i < n; i++) lr[i] = Math.log(b.c[i] / b.c[i - 1])
  const rv12 = new Float64Array(n).fill(NaN)
  for (let i = 12; i < n; i++) {
    let m = 0
    for (let j = i - 11; j <= i; j++) m += lr[j]
    m /= 12
    let s = 0
    for (let j = i - 11; j <= i; j++) s += (lr[j] - m) ** 2
    rv12[i] = Math.sqrt(s / 11)
  }
  const cumV = new Float64Array(n + 1)
  const cumRv = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    cumV[i + 1] = cumV[i] + b.v[i]
    cumRv[i + 1] = cumRv[i] + (Number.isFinite(rv12[i]) ? rv12[i] : 0)
  }
  return { ...b, n, rv12, cumV, cumRv }
}

/** Last funding settlement at or before T (binary search); -1 if none. */
export function fundingIndexAt(funding: FundingPoint[], T: number): number {
  let lo = 0
  let hi = funding.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (funding[mid].t <= T) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

/** Percentile (0–1) of the funding at index fi among the previous FUNDING_PCT_WINDOW settlements (including itself). */
export function fundingPercentile(funding: FundingPoint[], fi: number): number | null {
  if (fi < 0) return null
  const from = Math.max(0, fi - FUNDING_PCT_WINDOW + 1)
  const len = fi - from + 1
  if (len < FUNDING_PCT_MIN) return null
  const cur = funding[fi].rate
  let le = 0
  for (let j = from; j <= fi; j++) if (funding[j].rate <= cur) le++
  return le / len
}

/** OI snapshot boundary usable at T (both history and live): latest 5-minute boundary that is at least OI_LAG_MS old. */
export const oiBoundary = (T: number): number => Math.floor((T - OI_LAG_MS) / BAR_MS) * BAR_MS

export interface FeatureContext {
  oiAt: OiLookup
  funding: FundingPoint[]
  /** 4h trend regime as of T: -1 / 0 / +1 */
  trend: -1 | 0 | 1
}

/** Observation time of bar i: the CLOSE of the bar. */
export const observationTime = (s: Pick<Series, 't'>, i: number): number => s.t[i] + BAR_MS

/**
 * The market-state vector at bar i, or null when any input is unavailable (missing OI, too little funding history, …).
 * Reads bars <= i only.
 */
export function featureVector(s: Series, i: number, ctx: FeatureContext): Float64Array | null {
  if (i < MIN_BAR_INDEX || i >= s.n) return null
  const T = observationTime(s, i)
  const out = new Float64Array(FEATURES.length)
  let k = 0
  const c = s.c

  for (const back of [STEPS['5m'], STEPS['15m'], STEPS['30m'], STEPS['1h'], STEPS['4h'], STEPS['24h']]) out[k++] = (c[i] / c[i - back] - 1) * 100

  const t1 = oiBoundary(T)
  const oiNow = ctx.oiAt(t1)
  for (const back of [STEPS['5m'], STEPS['15m'], STEPS['30m'], STEPS['1h'], STEPS['4h'], STEPS['24h']]) {
    const oiPrev = ctx.oiAt(t1 - back * BAR_MS)
    if (oiNow === undefined || oiPrev === undefined || !(oiNow > 0) || !(oiPrev > 0)) return null
    out[k++] = (oiNow / oiPrev - 1) * 100
  }

  const fi = fundingIndexAt(ctx.funding, T)
  const pct = fundingPercentile(ctx.funding, fi)
  if (fi < 0 || pct === null) return null
  out[k++] = ctx.funding[fi].rate
  out[k++] = pct

  const vAvg = (s.cumV[i + 1] - s.cumV[i + 1 - BASELINE_BARS]) / BASELINE_BARS
  if (!(vAvg > 0)) return null
  for (const w of [STEPS['5m'], STEPS['15m'], STEPS['30m'], STEPS['1h']]) {
    const sum = s.cumV[i + 1] - s.cumV[i + 1 - w]
    if (!(sum > 0)) return null
    out[k++] = Math.log(sum / (w * vAvg))
  }

  const rvAvg = (s.cumRv[i + 1] - s.cumRv[i + 1 - BASELINE_BARS]) / BASELINE_BARS
  if (!(rvAvg > 0) || !(s.rv12[i] > 0)) return null
  out[k++] = Math.log(s.rv12[i] / rvAvg)

  let hi = -Infinity
  let lo = Infinity
  for (let j = i - RANGE_BARS + 1; j <= i; j++) {
    if (s.h[j] > hi) hi = s.h[j]
    if (s.l[j] < lo) lo = s.l[j]
  }
  out[k++] = (c[i] / hi - 1) * 100
  out[k++] = (c[i] / lo - 1) * 100

  out[k] = ctx.trend
  for (let q = 0; q < out.length; q++) if (!Number.isFinite(out[q])) return null
  return out
}

/** 4h trend regime from CLOSED spot 4h candles (last 300), reusing the scalp engine's own regime detector. */
export function trendFromCandles(closed4h: Candle[]): -1 | 0 | 1 {
  if (closed4h.length < DEFAULT_STRATEGY_CONFIG.emaSlow + 2) return 0
  const r = detectRegime(closed4h.slice(-300), DEFAULT_STRATEGY_CONFIG).regime
  return r === 'bullish' ? 1 : r === 'bearish' ? -1 : 0
}
