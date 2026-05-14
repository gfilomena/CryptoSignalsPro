import type { BollingerBands, SignalReasonEntry, SignalResult, SignalType } from '../types/domain'

const signalStateCache: Record<string, SignalType> = {}

export function resetSignalStateCache(): void {
  for (const k of Object.keys(signalStateCache)) delete signalStateCache[k]
}

interface AnalyzeInput {
  symbol?: string
  price: number
  rsi: number
  macd: number
  macdHistogram: number
  ema20: number
  ema50: number
  ema200: number
  bb: BollingerBands
  priceChange24h: number
  atrPct: number
  obvDivergence: 'none' | 'bullish' | 'bearish'
  obvTrend: number
  rsiDivergence: 'none' | 'bullish' | 'bearish'
}

function r(k: string, v?: Record<string, string | number>): SignalReasonEntry {
  return v ? { k, v } : { k }
}

export function analyzeLiveSignal(data: AnalyzeInput): SignalResult {
  let score = 0
  const reasons: SignalReasonEntry[] = []

  const aboveEma200 = data.ema200 && data.price > data.ema200
  const belowEma200 = data.ema200 && data.price < data.ema200
  if (aboveEma200) {
    score += 25
    reasons.push(r('ema200_bull'))
  } else if (belowEma200) {
    score -= 25
    reasons.push(r('ema200_bear'))
  }

  if (data.rsiDivergence === 'bullish') {
    score += 20
    reasons.push(r('rsi_div_bull'))
  } else if (data.rsiDivergence === 'bearish') {
    score -= 20
    reasons.push(r('rsi_div_bear'))
  }

  const rsi = data.rsi
  if (rsi < 25) {
    score += 15
    reasons.push(r('rsi_strong_oversold', { rsi: rsi.toFixed(1) }))
  } else if (rsi < 35) {
    score += Math.round((35 - rsi) * 1.5)
    reasons.push(r('rsi_low', { rsi: rsi.toFixed(1) }))
  } else if (rsi > 75) {
    score -= 15
    reasons.push(r('rsi_strong_overbought', { rsi: rsi.toFixed(1) }))
  } else if (rsi > 65) {
    score -= Math.round((rsi - 65) * 1.5)
    reasons.push(r('rsi_high', { rsi: rsi.toFixed(1) }))
  }

  const hist = data.macdHistogram || 0
  const macdPct = data.price > 0 ? (Math.abs(hist) / data.price) * 100 : 0
  if (hist > 0 && macdPct > 0.1) {
    score += 20
    reasons.push(r('macd_cross_bull'))
  } else if (hist > 0) {
    score += 8
    reasons.push(r('macd_slight_bull'))
  } else if (hist < 0 && macdPct > 0.1) {
    score -= 20
    reasons.push(r('macd_cross_bear'))
  } else if (hist < 0) {
    score -= 8
    reasons.push(r('macd_slight_bear'))
  }

  if (data.price < data.bb.lower) {
    score += 15
    reasons.push(r('bb_below'))
  } else if (data.price > data.bb.upper) {
    score -= 15
    reasons.push(r('bb_above'))
  } else {
    const bbRange = data.bb.upper - data.bb.lower
    if (bbRange > 0) {
      const bbPos = (data.price - data.bb.lower) / bbRange
      if (bbPos < 0.2) {
        score += 8
        reasons.push(r('bb_near_lower'))
      } else if (bbPos > 0.8) {
        score -= 8
        reasons.push(r('bb_near_upper'))
      }
    }
  }

  if (data.obvDivergence === 'bullish') {
    score += 10
    reasons.push(r('obv_div_bull'))
  } else if (data.obvDivergence === 'bearish') {
    score -= 10
    reasons.push(r('obv_div_bear'))
  }

  const chg = data.priceChange24h
  const atrPct = data.atrPct || 3
  const significantMove = atrPct * 2
  const moderateMove = atrPct
  if (chg < -significantMove) {
    score += 15
    reasons.push(r('pullback_strong', { chg: chg.toFixed(1) }))
  } else if (chg < -moderateMove) {
    score += 8
    reasons.push(r('pullback_mod', { chg: chg.toFixed(1) }))
  } else if (chg > significantMove) {
    score -= 15
    reasons.push(r('rally_strong', { chg: chg.toFixed(1) }))
  } else if (chg > moderateMove) {
    score -= 8
    reasons.push(r('rally_mod', { chg: chg.toFixed(1) }))
  }

  let type: SignalType = 'neutral'
  if (score >= 45) {
    type = belowEma200 ? 'neutral' : 'buy'
    if (belowEma200) reasons.push(r('buy_blocked_ema'))
  } else if (score <= -45) {
    type = aboveEma200 ? 'neutral' : 'sell'
    if (aboveEma200) reasons.push(r('sell_blocked_ema'))
  }

  const cacheKey = data.symbol || 'default'
  const prev = signalStateCache[cacheKey]
  if (prev && prev !== 'neutral' && type === 'neutral') {
    if (prev === 'buy' && score > 20) {
      type = 'buy'
      reasons.push(r('hysteresis_buy'))
    } else if (prev === 'sell' && score < -20) {
      type = 'sell'
      reasons.push(r('hysteresis_sell'))
    }
  }
  signalStateCache[cacheKey] = type

  return {
    type,
    score,
    confidence: Math.min(100, Math.abs(score)),
    reasons,
  }
}
