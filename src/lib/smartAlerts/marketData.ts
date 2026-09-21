// Binance USDT-M Futures market data for Smart Alerts (price, open interest, funding rate,
// volume, RSI). This app previously only talked to Binance **spot** (api.binance.com — see
// src/lib/marketData.ts and src/lib/scalp/klines.ts); open interest and funding rate only exist
// on the Futures API (fapi.binance.com), so this module is a new, futures-specific adapter. It
// intentionally never duplicates the existing spot price polling.
//
// KNOWN GAP — liquidations: Binance has no public REST endpoint for aggregate long/short
// liquidation volume (only a per-order websocket stream, `!forceOrder@arr`, which requires a
// persistent connection and server-side aggregation to turn into a metric). LONG_LIQUIDATIONS /
// SHORT_LIQUIDATIONS / LIQUIDATION_SPIKE are therefore always reported as unavailable (`null`)
// until a dedicated ingestion service is built — see the final report for details. Conditions
// referencing them are never silently treated as matched; see conditionEngine.ts.
import type { MetricSnapshot, MetricTimeframe } from '../../types/smartAlert'
import { METRIC_TIMEFRAMES } from '../../types/smartAlert'
import { calculateRSI } from '../indicators'
import type { Candle } from '../../types/scalpSignal'

const FAPI_BASE = 'https://fapi.binance.com'

export function toFuturesPair(symbol: string): string {
  const s = symbol.toUpperCase()
  return s.endsWith('USDT') ? s : `${s}USDT`
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Binance futures ${res.status} for ${url}`)
  return (await res.json()) as T
}

interface Ticker24hr {
  lastPrice: string
  priceChangePercent: string
  quoteVolume: string
}

async function fetchTicker24hr(pair: string): Promise<{ price: number; priceChangePct: number; volume: number }> {
  const data = await getJson<Ticker24hr>(`${FAPI_BASE}/fapi/v1/ticker/24hr?symbol=${pair}`)
  return {
    price: parseFloat(data.lastPrice),
    priceChangePct: parseFloat(data.priceChangePercent),
    volume: parseFloat(data.quoteVolume),
  }
}

interface OpenInterestResp {
  openInterest: string
}

async function fetchOpenInterest(pair: string): Promise<number> {
  const data = await getJson<OpenInterestResp>(`${FAPI_BASE}/fapi/v1/openInterest?symbol=${pair}`)
  return parseFloat(data.openInterest)
}

interface OpenInterestHistPoint {
  sumOpenInterest: string
  timestamp: number
}

/** % change in open interest over one lookback window, using Binance's own periodized history
 * endpoint (each point already aggregates that period, so two consecutive points = exactly one
 * period apart). */
async function fetchOpenInterestChangePct(pair: string, timeframe: MetricTimeframe): Promise<number | null> {
  const url = `${FAPI_BASE}/futures/data/openInterestHist?symbol=${pair}&period=${timeframe}&limit=2`
  const data = await getJson<OpenInterestHistPoint[]>(url)
  if (data.length < 2) return null
  const prev = parseFloat(data[0].sumOpenInterest)
  const latest = parseFloat(data[data.length - 1].sumOpenInterest)
  if (!Number.isFinite(prev) || prev === 0) return null
  return ((latest - prev) / prev) * 100
}

interface PremiumIndexResp {
  lastFundingRate: string
}

/** Returned as percentage points (0.0001 decimal -> 0.01), matching how thresholds are written
 * throughout the spec ("Funding Rate >= 0.01%"). */
async function fetchFundingRatePct(pair: string): Promise<number> {
  const data = await getJson<PremiumIndexResp>(`${FAPI_BASE}/fapi/v1/premiumIndex?symbol=${pair}`)
  return parseFloat(data.lastFundingRate) * 100
}

async function fetchFuturesCandles(pair: string, interval: string, limit: number): Promise<Candle[]> {
  const raw = await getJson<(string | number)[][]>(`${FAPI_BASE}/fapi/v1/klines?symbol=${pair}&interval=${interval}&limit=${limit}`)
  return raw.map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
    closeTime: Number(k[6]),
  }))
}

async function fetchRsiAt(pair: string, timeframe: MetricTimeframe): Promise<number | null> {
  const candles = await fetchFuturesCandles(pair, timeframe, 200)
  if (candles.length < 15) return null
  return calculateRSI(candles.map((c) => c.close))
}

/** % change between the two most recently closed candles' quote volume at this timeframe. */
async function fetchVolumeChangePct(pair: string, timeframe: MetricTimeframe): Promise<number | null> {
  const candles = await fetchFuturesCandles(pair, timeframe, 3)
  if (candles.length < 3) return null
  const closed = candles.slice(0, -1) // drop the still-forming candle
  const prev = closed[closed.length - 2]
  const latest = closed[closed.length - 1]
  if (!prev || prev.volume === 0) return null
  return ((latest.volume - prev.volume) / prev.volume) * 100
}

/** Always unavailable today — see the module-level comment on the liquidation data gap. */
function fetchLiquidations(): { long: null; short: null; spike: null } {
  return { long: null, short: null, spike: null }
}

async function settled<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise
  } catch {
    return null
  }
}

/**
 * Fetches every metric a Smart Alert condition can reference for one symbol, in parallel.
 * Any individual metric that fails to fetch degrades to `null` (unavailable) rather than
 * throwing — one flaky endpoint never blocks the rest of the snapshot (spec §19: "Missing
 * Binance data" / "API errors" must never crash the alert evaluation).
 */
export async function fetchSmartAlertSnapshot(symbol: string, timeframes: MetricTimeframe[] = METRIC_TIMEFRAMES): Promise<MetricSnapshot> {
  const pair = toFuturesPair(symbol)

  const [ticker, openInterest, fundingRate] = await Promise.all([
    settled(fetchTicker24hr(pair)),
    settled(fetchOpenInterest(pair)),
    settled(fetchFundingRatePct(pair)),
  ])

  const [oiChangeEntries, rsiEntries, volumeChangeEntries] = await Promise.all([
    Promise.all(timeframes.map(async (tf) => [tf, await settled(fetchOpenInterestChangePct(pair, tf))] as const)),
    Promise.all(timeframes.map(async (tf) => [tf, await settled(fetchRsiAt(pair, tf))] as const)),
    Promise.all(timeframes.map(async (tf) => [tf, await settled(fetchVolumeChangePct(pair, tf))] as const)),
  ])

  const liquidations = fetchLiquidations()

  return {
    symbol: symbol.toUpperCase(),
    timestamp: Date.now(),
    price: ticker?.price ?? null,
    priceChangePct: ticker?.priceChangePct ?? null,
    openInterest: openInterest ?? null,
    openInterestChangePct: Object.fromEntries(oiChangeEntries),
    fundingRate: fundingRate ?? null,
    volume: ticker?.volume ?? null,
    volumeChangePct: Object.fromEntries(volumeChangeEntries),
    rsi: Object.fromEntries(rsiEntries),
    longLiquidations: liquidations.long,
    shortLiquidations: liquidations.short,
    liquidationSpike: liquidations.spike,
  }
}

export { UNAVAILABLE_METRICS } from './metricDefs'
