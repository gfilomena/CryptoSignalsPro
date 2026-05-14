import type { AssetTier, BtAsset, SignalType } from '../src/types/domain'
import {
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateOBV,
  calculateRSI,
  detectRSIDivergence,
} from '../src/lib/indicators'
import { BT_ASSETS } from '../src/constants/btAssets'

export interface BacktestWeights {
  ema200: number
  rsiDiv: number
  rsi: number
  macd: number
  bb: number
  obv: number
  atr: number
}

export interface BacktestParams {
  interval: string
  days: number | null
  useCustomRange: boolean
  dateFrom: string | null
  dateTo: string | null
  buyThresh: number
  sellThresh: number
  minConfidence: number
  stopLoss: { major: number; altcoin: number; meme: number }
  trailingActivation: number
  trailingStep: number
  maxPositions: number
  weights: BacktestWeights
  assets: string[]
}

export interface SimTrade {
  id: number
  symbol: string
  tier: AssetTier
  direction: 'long' | 'short'
  entryPrice: number
  entryTime: number
  qty: number
  hwm: number
  level: number
  exitPrice?: number
  pnl?: number
  pnlPct?: number
  exitReason?: string
  exitTime?: number
}

export interface DailyEquityPoint {
  time: number
  equity: number
}

export interface BacktestResult {
  params: BacktestParams
  totalPnl: number
  pnlPct: number
  bhPct: number
  alpha: number
  maxDrawdown: number
  profitFactor: number
  winRate: number
  totalTrades: number
  winners: number
  losers: number
  avgWin: number
  avgLoss: number
  closedTrades: SimTrade[]
  dailyEquity: DailyEquityPoint[]
  date: string
}

export function parseYmdUtcStart(ymd: string): number {
  const parts = ymd.split('-').map(Number)
  if (parts.length !== 3) return NaN
  return Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0)
}

export function parseYmdUtcEnd(ymd: string): number {
  const parts = ymd.split('-').map(Number)
  if (parts.length !== 3) return NaN
  return Date.UTC(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999)
}

export type CustomRangeResult =
  | null
  | 'incomplete'
  | 'invalid'
  | 'short'
  | 'long'
  | { start: number; end: number; dateFrom: string; dateTo: string }

export function readCustomDateRange(dateFrom: string, dateTo: string): CustomRangeResult {
  if (!dateFrom && !dateTo) return null
  if (!dateFrom || !dateTo) return 'incomplete'
  const start = parseYmdUtcStart(dateFrom)
  const endRaw = parseYmdUtcEnd(dateTo)
  const now = Date.now()
  if (!Number.isFinite(start) || !Number.isFinite(endRaw)) return 'invalid'
  const end = Math.min(endRaw, now)
  if (end <= start) return 'invalid'
  const spanDays = (end - start) / (24 * 3600 * 1000)
  if (spanDays < 1) return 'short'
  if (spanDays > 800) return 'long'
  return { start, end, dateFrom, dateTo }
}

function analyzeBacktestSignal(
  data: {
    price: number
    rsi: number
    macdHist: number
    ema20: number
    ema50: number
    ema200: number | null
    bb: { upper: number; lower: number }
    obvDiv: string
    rsiDiv: string
    atrPct: number
    priceChange: number
  },
  weights: BacktestWeights,
  buyThresh: number,
  sellThresh: number,
): { type: SignalType; score: number; confidence: number } {
  let score = 0
  const w = weights
  const aboveEma200 = data.ema200 && data.price > data.ema200
  const belowEma200 = data.ema200 && data.price < data.ema200
  if (aboveEma200) score += w.ema200
  else if (belowEma200) score -= w.ema200
  if (data.rsiDiv === 'bullish') score += w.rsiDiv
  else if (data.rsiDiv === 'bearish') score -= w.rsiDiv
  if (data.rsi < 30) score += w.rsi
  else if (data.rsi > 70) score -= w.rsi
  if (data.macdHist > 0) score += w.macd
  else if (data.macdHist < 0) score -= w.macd
  if (data.price < data.bb.lower) score += w.bb
  else if (data.price > data.bb.upper) score -= w.bb
  if (data.obvDiv === 'bullish') score += w.obv
  else if (data.obvDiv === 'bearish') score -= w.obv
  const atrPct = data.atrPct || 3
  const chg = data.priceChange
  if (chg < -(atrPct * 2)) score += w.atr
  else if (chg < -atrPct) score += Math.round(w.atr * 0.5)
  else if (chg > atrPct * 2) score -= w.atr
  else if (chg > atrPct) score -= Math.round(w.atr * 0.5)

  let type: SignalType = 'neutral'
  if (score >= buyThresh) type = belowEma200 && w.ema200 > 0 ? 'neutral' : 'buy'
  else if (score <= sellThresh) type = aboveEma200 && w.ema200 > 0 ? 'neutral' : 'sell'
  return { type, score, confidence: Math.min(100, Math.abs(score)) }
}

export async function btFetchKlines(symbol: string, interval: string, startTime: number, endTime: number): Promise<number[][]> {
  const all: number[][] = []
  let cursor = startTime
  while (cursor < endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=1000`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Binance ${res.status} for ${symbol}`)
    const batch = (await res.json()) as number[][]
    if (batch.length === 0) break
    all.push(...batch)
    cursor = batch[batch.length - 1][6] + 1
    if (batch.length < 1000) break
    await new Promise((r) => setTimeout(r, 80))
  }
  return all
}

export interface BacktestProgress {
  pct: number
  textKey?: string
  textParams?: Record<string, string | number>
}

export async function runBacktestSimulation(
  params: BacktestParams,
  onProgress: (p: BacktestProgress) => void,
): Promise<BacktestResult> {
  const now = Date.now()
  let simStart: number
  let simEnd: number
  if (params.useCustomRange && params.dateFrom && params.dateTo) {
    const custom = readCustomDateRange(params.dateFrom, params.dateTo)
    if (typeof custom !== 'object' || custom === null) throw new Error('Invalid custom range')
    simStart = custom.start
    simEnd = custom.end
  } else {
    simEnd = now
    const d = params.days
    if (d == null || !Number.isFinite(d) || d <= 0) throw new Error('Invalid period')
    simStart = now - d * 24 * 3600 * 1000
  }

  const warmupMs = 210 * 3600000
  const warmupStart = simStart - warmupMs
  const selectedAssets = BT_ASSETS.filter((a) => params.assets.includes(a.symbol))
  const totalSteps = selectedAssets.length
  const assetData: Record<
    string,
    { klines: number[][]; closes: number[]; volumes: number[]; times: number[] }
  > = {}

  for (let i = 0; i < selectedAssets.length; i++) {
    const asset = selectedAssets[i]
    const pct = Math.round((i / totalSteps) * 60)
    onProgress({
      pct,
      textKey: 'backtest.progress.download',
      textParams: { symbol: asset.symbol, current: i + 1, total: totalSteps },
    })
    const klines = await btFetchKlines(asset.pair, params.interval, warmupStart, simEnd)
    if (klines.length > 50) {
      assetData[asset.symbol] = {
        klines,
        closes: klines.map((k) => +k[4]),
        volumes: klines.map((k) => +k[5]),
        times: klines.map((k) => k[0]),
      }
    }
    await new Promise((r) => setTimeout(r, 50))
  }

  const loadedAssets = selectedAssets.filter((a) => assetData[a.symbol])
  if (loadedAssets.length === 0) throw new Error('I18N:backtest.errors.no_data')

    onProgress({ pct: 62, textKey: 'backtest.progress.simulating' })
  await new Promise((r) => setTimeout(r, 20))

  const config = {
    maxPositions: params.maxPositions,
    minConfidence: params.minConfidence,
    trailingActivation: params.trailingActivation,
    trailingStep: params.trailingStep,
    stopLoss: params.stopLoss,
    tiers: {
      major: { maxPerAsset: 3, scalingDropPct: 3, sizeMultiplier: 1, scalingMultipliers: [1, 1.5, 2] },
      altcoin: { maxPerAsset: 2, scalingDropPct: 4.5, sizeMultiplier: 0.75, scalingMultipliers: [1, 1.5] },
      meme: { maxPerAsset: 1, scalingDropPct: 7, sizeMultiplier: 0.5, scalingMultipliers: [1] },
    },
  }
  const initialCapital = 10000

  const btcData = assetData['BTC'] || assetData[Object.keys(assetData)[0]]
  const simStartIdx = btcData.times.findIndex((t) => t >= simStart)
  if (simStartIdx < 0) throw new Error('I18N:backtest.errors.no_candles')
  if (btcData.times[simStartIdx] > simEnd) throw new Error('I18N:backtest.errors.narrow_range')

  let simTickCount = 0
  for (let j = simStartIdx; j < btcData.times.length && btcData.times[j] <= simEnd; j++) simTickCount++
  const totalTicks = simTickCount || 1
  const openTrades: SimTrade[] = []
  const closedTrades: SimTrade[] = []
  let tradeId = 0
  let peakCapital = initialCapital
  let maxDrawdown = 0
  const dailyEquity: DailyEquityPoint[] = []

  for (let tickI = simStartIdx; tickI < btcData.times.length; tickI++) {
    const tickTime = btcData.times[tickI]
    if (tickTime > simEnd) break
    if (tickI % 20 === 0) {
      const simPct = 60 + Math.round(((tickI - simStartIdx) / totalTicks) * 38)
      onProgress({
        pct: simPct,
        textKey: 'backtest.progress.simPct',
        textParams: { pct: Math.round(((tickI - simStartIdx) / totalTicks) * 100) },
      })
      await new Promise((r) => setTimeout(r, 0))
    }

    const signals: { asset: BtAsset; price: number; signal: ReturnType<typeof analyzeBacktestSignal> }[] = []
    for (const asset of loadedAssets) {
      const ad = assetData[asset.symbol]
      const idx = ad.times.findIndex((t) => t >= tickTime)
      if (idx < 0 || idx < 26) continue
      const price = ad.closes[idx]
      const closes = ad.closes.slice(0, idx + 1)
      const volumes = ad.volumes.slice(0, idx + 1)

      const rsi = calculateRSI(closes)
      const macd = calculateMACD(closes)
      const ema20 = calculateEMA(closes, 20)
      const ema50 = calculateEMA(closes, 50)
      const ema200 = closes.length >= 200 ? calculateEMA(closes, 200) : null
      const bb = calculateBollingerBands(closes)
      const obv = calculateOBV(closes, volumes)
      const rsiDiv = detectRSIDivergence(closes)
      const atr = calculateATR(ad.klines.slice(0, idx + 1))
      const atrPct = price > 0 ? (atr / price) * 100 : 3

      const lookback = Math.max(0, idx - 24)
      const priceChange = ((price - ad.closes[lookback]) / ad.closes[lookback]) * 100

      const signal = analyzeBacktestSignal(
        {
          price,
          rsi,
          macdHist: macd.histogram,
          ema20,
          ema50,
          ema200,
          bb,
          obvDiv: obv.divergence,
          rsiDiv,
          atrPct,
          priceChange,
        },
        params.weights,
        params.buyThresh,
        params.sellThresh,
      )

      signals.push({ asset, price, signal })
    }

    for (let j = openTrades.length - 1; j >= 0; j--) {
      const trade = openTrades[j]
      const sig = signals.find((s) => s.asset.symbol === trade.symbol)
      if (!sig) continue
      const price = sig.price
      const pnlPct =
        trade.direction === 'long'
          ? ((price - trade.entryPrice) / trade.entryPrice) * 100
          : ((trade.entryPrice - price) / trade.entryPrice) * 100
      const pnl =
        trade.direction === 'long'
          ? (price - trade.entryPrice) * trade.qty
          : (trade.entryPrice - price) * trade.qty

      if (pnlPct > trade.hwm) trade.hwm = pnlPct
      let exitReason: string | null = null

      if (trade.hwm >= config.trailingActivation && trade.hwm - pnlPct >= config.trailingStep) exitReason = 'trailing_tp'
      if (!exitReason) {
        const sl = config.stopLoss[trade.tier as keyof typeof config.stopLoss] || -12
        if (pnlPct <= sl) exitReason = 'stop_loss'
      }
      if (!exitReason && pnlPct >= 0) {
        if (
          (trade.direction === 'long' &&
            sig.signal.type === 'sell' &&
            sig.signal.confidence >= config.minConfidence) ||
          (trade.direction === 'short' &&
            sig.signal.type === 'buy' &&
            sig.signal.confidence >= config.minConfidence)
        )
          exitReason = 'signal_reversal'
      }

      if (exitReason) {
        trade.exitPrice = price
        trade.pnl = pnl
        trade.pnlPct = pnlPct
        trade.exitReason = exitReason
        trade.exitTime = tickTime
        closedTrades.push(trade)
        openTrades.splice(j, 1)
      }
    }

    if (openTrades.length < config.maxPositions) {
      const sorted = signals
        .filter((s) => s.signal.confidence >= config.minConfidence && s.signal.type !== 'neutral')
        .sort((a, b) => b.signal.confidence - a.signal.confidence)
      for (const s of sorted) {
        if (openTrades.length >= config.maxPositions) break
        const direction = s.signal.type === 'buy' ? 'long' : 'short'
        const tierCfg = config.tiers[s.asset.tier]
        const existing = openTrades.filter((t) => t.symbol === s.asset.symbol)
        const level = existing.length
        if (level >= tierCfg.maxPerAsset) continue
        if (level > 0) {
          const last = existing[existing.length - 1]
          const drop = ((last.entryPrice - s.price) / last.entryPrice) * 100
          if (direction === 'long' && drop < tierCfg.scalingDropPct) continue
          if (last.direction !== direction) continue
        }
        const realPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0)
        const invested = openTrades.reduce((sum, t) => sum + t.qty * t.entryPrice, 0)
        const avail = initialCapital + realPnl - invested
        const slots = config.maxPositions - openTrades.length
        const base = Math.max(0, avail / slots)
        const scale = (tierCfg.scalingMultipliers || [1])[level] || 1
        const posVal = Math.min(base * scale * tierCfg.sizeMultiplier, avail * 0.4)
        if (posVal < 10) continue
        openTrades.push({
          id: ++tradeId,
          symbol: s.asset.symbol,
          tier: s.asset.tier,
          direction,
          entryPrice: s.price,
          entryTime: tickTime,
          qty: posVal / s.price,
          hwm: 0,
          level: level + 1,
        })
      }
    }

    const realPnl = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0)
    let unreal = 0
    for (const t of openTrades) {
      const sig = signals.find((s) => s.asset.symbol === t.symbol)
      if (sig)
        unreal +=
          t.direction === 'long'
            ? (sig.price - t.entryPrice) * t.qty
            : (t.entryPrice - sig.price) * t.qty
    }
    const curCap = initialCapital + realPnl + unreal
    if (curCap > peakCapital) peakCapital = curCap
    const dd = ((peakCapital - curCap) / peakCapital) * 100
    if (dd > maxDrawdown) maxDrawdown = dd
    dailyEquity.push({ time: tickTime, equity: curCap })
  }

  for (const trade of openTrades) {
    const ad = assetData[trade.symbol]
    if (!ad) continue
    const price = ad.closes[ad.closes.length - 1]
    const pnlPct =
      trade.direction === 'long'
        ? ((price - trade.entryPrice) / trade.entryPrice) * 100
        : ((trade.entryPrice - price) / trade.entryPrice) * 100
    const pnl =
      trade.direction === 'long'
        ? (price - trade.entryPrice) * trade.qty
        : (trade.entryPrice - price) * trade.qty
    if (pnlPct >= 0) {
      trade.exitPrice = price
      trade.pnl = pnl
      trade.pnlPct = pnlPct
      trade.exitReason = 'session_end'
      trade.exitTime = simEnd
      closedTrades.push(trade)
    }
  }

  const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0)
  const winners = closedTrades.filter((t) => (t.pnl || 0) > 0)
  const losers = closedTrades.filter((t) => (t.pnl || 0) <= 0)
  const winRate = closedTrades.length > 0 ? (winners.length / closedTrades.length) * 100 : 0
  const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + (t.pnl || 0), 0) / winners.length : 0
  const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + (t.pnl || 0), 0) / losers.length : 0
  const profitFactor =
    Math.abs(avgLoss) > 0 && winners.length > 0
      ? winners.reduce((s, t) => s + (t.pnl || 0), 0) / Math.abs(losers.reduce((s, t) => s + (t.pnl || 0), 0) || 1)
      : 0
  const firstAsset = assetData[Object.keys(assetData)[0]]
  const bhStart = firstAsset.closes[simStartIdx]
  const bhEnd = firstAsset.closes[firstAsset.closes.length - 1]
  const bhPct = ((bhEnd - bhStart) / bhStart) * 100

  return {
    params,
    totalPnl,
    pnlPct: (totalPnl / initialCapital) * 100,
    bhPct,
    alpha: (totalPnl / initialCapital) * 100 - bhPct,
    maxDrawdown,
    profitFactor,
    winRate,
    totalTrades: closedTrades.length,
    winners: winners.length,
    losers: losers.length,
    avgWin,
    avgLoss,
    closedTrades,
    dailyEquity,
    date: new Date().toISOString(),
  }
}
