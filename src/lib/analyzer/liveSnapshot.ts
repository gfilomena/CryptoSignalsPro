// Live market snapshot for the analyzer. Reuses the existing Binance plumbing (futures REST helpers from the Smart Alerts
// module, spot candle fetch + closed-candle filter from the scalp engine) — no new Binance connection style.
//
// The snapshot is FROZEN at T = close of the last CLOSED 5-minute bar: every input is cut at T, so the same inputs always give
// the same vector (reproducible), and nothing newer than T can enter it.
import { BAR_MS, BASELINE_BARS, RANGE_BARS } from './config'
import { featureVector, FEATURE_NAMES, fundingIndexAt, fundingPercentile, observationTime, prepareSeries, trendFromCandles, type FundingPoint } from './features'
import { FAPI_BASE, getJson, toFuturesPair } from '../smartAlerts/marketData'
import { closedCandles, fetchCandles } from '../scalp/klines'
import type { Candle } from '../../types/scalpSignal'

export interface Bar5 { t: number; o: number; h: number; l: number; c: number; v: number; ct: number }

export interface LiveInputs {
  capturedAt: number
  bars5m: Bar5[]
  oi: { t: number; oi: number }[]
  funding: FundingPoint[]
  spot4h: Candle[]
  lastPrice: number | null
  markPrice: number | null
  indexPrice: number | null
}

export class AnalyzerDataError extends Error {
  reason: string
  constructor(reason: string) { super(`analyzer_data_unavailable:${reason}`); this.reason = reason }
}

export interface SnapshotDisplay {
  price: number
  markPrice: number | null
  indexPrice: number | null
  /** % change of the futures close over 5m/15m/30m/1h/4h/24h */
  priceChangePct: Record<string, number>
  oiChangePct: Record<string, number>
  oiLatest: number
  fundingRatePct: number
  fundingHistoryPct: number[]
  fundingPercentile: number
  volume: Record<string, number>
  volumeRatio: Record<string, number>
  volumePercentile1h: number
  high24h: number
  low24h: number
  distFromHighPct: number
  distFromLowPct: number
  realisedVol1hPct: number
  volRatio: number
  trend4h: -1 | 0 | 1
  /** parameters the application/archive cannot provide (never invented) */
  unavailable: string[]
}

export interface AnalyzerSnapshot {
  /** observation time T (ms): close of the last closed 5-minute bar */
  t: number
  /** close of that bar: the reference price every historical outcome (and the realised outcomes of this analysis) is measured from */
  entryPrice: number
  capturedAt: number
  featureNames: string[]
  vector: number[]
  display: SnapshotDisplay
}

const num = (x: unknown): number => parseFloat(String(x))

export async function fetchLiveInputs(symbol = 'BTC', now = Date.now()): Promise<LiveInputs> {
  const pair = toFuturesPair(symbol)
  const [klines, oiHist, fundingHist, spot4hRaw, premium, ticker] = await Promise.all([
    getJson<(string | number)[][]>(`${FAPI_BASE}/fapi/v1/klines?symbol=${pair}&interval=5m&limit=1500`),
    getJson<{ timestamp: number; sumOpenInterest: string }[]>(`${FAPI_BASE}/futures/data/openInterestHist?symbol=${pair}&period=5m&limit=500`),
    getJson<{ fundingTime: number; fundingRate: string }[]>(`${FAPI_BASE}/fapi/v1/fundingRate?symbol=${pair}&limit=300`),
    fetchCandles(pair, '4h', 300),
    getJson<{ markPrice: string; indexPrice: string }>(`${FAPI_BASE}/fapi/v1/premiumIndex?symbol=${pair}`).catch(() => null),
    getJson<{ price: string }>(`${FAPI_BASE}/fapi/v1/ticker/price?symbol=${pair}`).catch(() => null),
  ])
  const bars5m: Bar5[] = klines
    .map((k) => ({ t: Number(k[0]), o: num(k[1]), h: num(k[2]), l: num(k[3]), c: num(k[4]), v: num(k[5]), ct: Number(k[6]) }))
    .filter((b) => b.ct < now) // drop the still-forming bar
  return {
    capturedAt: now,
    bars5m,
    oi: oiHist.map((p) => ({ t: p.timestamp, oi: num(p.sumOpenInterest) })),
    funding: fundingHist.map((f) => ({ t: f.fundingTime, rate: num(f.fundingRate) * 100 })).sort((a, b) => a.t - b.t),
    spot4h: closedCandles(spot4hRaw, now),
    lastPrice: ticker ? num(ticker.price) : null,
    markPrice: premium ? num(premium.markPrice) : null,
    indexPrice: premium ? num(premium.indexPrice) : null,
  }
}

/** Pure: inputs → frozen snapshot. Throws AnalyzerDataError naming the missing input (never fabricates a value). */
export function buildSnapshot(inp: LiveInputs): AnalyzerSnapshot {
  const bars = inp.bars5m.filter((b) => b.ct < inp.capturedAt)
  if (bars.length < BASELINE_BARS + 300) throw new AnalyzerDataError('not_enough_5m_bars')
  const series = prepareSeries({ t: bars.map((b) => b.t), h: bars.map((b) => b.h), l: bars.map((b) => b.l), c: bars.map((b) => b.c), v: bars.map((b) => b.v) })
  const i = series.n - 1
  const T = observationTime(series, i)
  const oiMap = new Map<number, number>()
  for (const p of inp.oi) if (p.oi > 0) oiMap.set(p.t, p.oi)
  const funding = inp.funding.filter((f) => f.t <= T)
  const trend = trendFromCandles(inp.spot4h.filter((c) => c.closeTime < T))
  const vec = featureVector(series, i, { oiAt: (t) => oiMap.get(t), funding, trend })
  if (!vec) {
    const why = funding.length === 0 ? 'funding' : oiMap.size === 0 ? 'open_interest' : 'open_interest_or_funding_history'
    throw new AnalyzerDataError(why)
  }
  const g = (name: string) => vec[FEATURE_NAMES.indexOf(name)]
  const vNow = (w: number) => series.cumV[i + 1] - series.cumV[i + 1 - w]
  const vAvg = (series.cumV[i + 1] - series.cumV[i + 1 - BASELINE_BARS]) / BASELINE_BARS
  // percentile of the current 1h volume among the rolling 1h volumes of the previous 3 days
  let le = 0
  let tot = 0
  const cur1h = vNow(12)
  for (let j = i - BASELINE_BARS + 12; j <= i; j++) {
    const s = series.cumV[j + 1] - series.cumV[j + 1 - 12]
    tot++
    if (s <= cur1h) le++
  }
  let hi = -Infinity
  let lo = Infinity
  for (let j = i - RANGE_BARS + 1; j <= i; j++) { hi = Math.max(hi, series.h[j]); lo = Math.min(lo, series.l[j]) }
  const fi = fundingIndexAt(funding, T)
  const fpct = fundingPercentile(funding, fi) ?? NaN
  const c = series.c
  const back = { '5m': 1, '15m': 3, '30m': 6, '1h': 12, '4h': 48, '24h': 288 } as const
  const pc: Record<string, number> = {}
  for (const [k, b] of Object.entries(back)) pc[k] = (c[i] / c[i - b] - 1) * 100
  const oc: Record<string, number> = {}
  for (const k of Object.keys(back)) oc[k] = g(`oi_${k}`)
  const t1 = Math.floor((T - 600_000) / BAR_MS) * BAR_MS
  return {
    t: T,
    entryPrice: c[i],
    capturedAt: inp.capturedAt,
    featureNames: FEATURE_NAMES,
    vector: Array.from(vec),
    display: {
      price: inp.lastPrice ?? c[i],
      markPrice: inp.markPrice,
      indexPrice: inp.indexPrice,
      priceChangePct: pc,
      oiChangePct: oc,
      oiLatest: oiMap.get(t1) ?? NaN,
      fundingRatePct: funding[fi].rate,
      fundingHistoryPct: funding.slice(-3).map((f) => f.rate),
      fundingPercentile: fpct,
      volume: { '5m': vNow(1), '15m': vNow(3), '30m': vNow(6), '1h': vNow(12) },
      volumeRatio: { '5m': vNow(1) / vAvg, '15m': vNow(3) / (3 * vAvg), '30m': vNow(6) / (6 * vAvg), '1h': vNow(12) / (12 * vAvg) },
      volumePercentile1h: le / tot,
      high24h: hi,
      low24h: lo,
      distFromHighPct: g('dist_high_24h'),
      distFromLowPct: g('dist_low_24h'),
      realisedVol1hPct: series.rv12[i] * 100,
      volRatio: Math.exp(g('vol_ratio')),
      trend4h: trend,
      unavailable: ['liquidations (no public Binance aggregate feed and no history)', 'order book / spread', 'breakout / rejection markers'],
    },
  }
}
