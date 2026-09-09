import { calculateEMA } from '../indicators'
import type { Candle, MarketRegime } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

export interface RegimeResult {
  regime: MarketRegime
  price: number
  ema20: number
  ema50: number
  ema200: number
  ema20Slope: number
  ema50Slope: number
}

const NEUTRAL_RESULT = (price: number, ema20: number, ema50: number, ema200: number): RegimeResult => ({
  regime: 'neutral',
  price,
  ema20,
  ema50,
  ema200,
  ema20Slope: 0,
  ema50Slope: 0,
})

/**
 * Higher-timeframe market regime (bullish/bearish/neutral) from EMA stack + slope.
 * LONG bias: price > EMA200, EMA fast > EMA medium, both rising.
 * SHORT bias: mirror. Anything else (incl. insufficient data) is NEUTRAL — no aggressive
 * signals in a sideways market.
 */
export function detectRegime(candles: Candle[], config: StrategyConfig): RegimeResult {
  const closes = candles.map((c) => c.close)
  if (closes.length < config.emaSlow + 2) return NEUTRAL_RESULT(closes[closes.length - 1] ?? 0, 0, 0, 0)

  const price = closes[closes.length - 1]
  const prevCloses = closes.slice(0, -1)

  const ema20 = calculateEMA(closes, config.emaFast)
  const ema20Prev = calculateEMA(prevCloses, config.emaFast)
  const ema50 = calculateEMA(closes, config.emaMedium)
  const ema50Prev = calculateEMA(prevCloses, config.emaMedium)
  const ema200 = calculateEMA(closes, config.emaSlow)

  const ema20Slope = ema20 - ema20Prev
  const ema50Slope = ema50 - ema50Prev

  const bullish = price > ema200 && ema20 > ema50 && ema20Slope > 0 && ema50Slope > 0
  const bearish = price < ema200 && ema20 < ema50 && ema20Slope < 0 && ema50Slope < 0

  return {
    regime: bullish ? 'bullish' : bearish ? 'bearish' : 'neutral',
    price,
    ema20,
    ema50,
    ema200,
    ema20Slope,
    ema50Slope,
  }
}
