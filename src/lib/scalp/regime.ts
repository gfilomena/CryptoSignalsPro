import { calculateEMA } from '../indicators'
import type { Candle, MarketRegime } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

export type SwingStructure = 'bullish' | 'bearish' | 'neutral'

export interface RegimeResult {
  regime: MarketRegime
  price: number
  ema20: number
  ema50: number
  ema200: number
  ema20Slope: number
  ema50Slope: number
  structure: SwingStructure
}

const NEUTRAL_RESULT = (price: number, ema20: number, ema50: number, ema200: number): RegimeResult => ({
  regime: 'neutral',
  price,
  ema20,
  ema50,
  ema200,
  ema20Slope: 0,
  ema50Slope: 0,
  structure: 'neutral',
})

/**
 * Compares the price range of the most recent `lookback` candles against the `lookback` before
 * that: higher high + higher low = bullish structure, lower high + lower low = bearish, anything
 * mixed (e.g. a higher high but a lower low) is neutral/range — no clean directional structure.
 */
export function detectSwingStructure(candles: Candle[], lookback: number): SwingStructure {
  if (candles.length < lookback * 2) return 'neutral'
  const older = candles.slice(-lookback * 2, -lookback)
  const newer = candles.slice(-lookback)
  const olderHigh = Math.max(...older.map((c) => c.high))
  const olderLow = Math.min(...older.map((c) => c.low))
  const newerHigh = Math.max(...newer.map((c) => c.high))
  const newerLow = Math.min(...newer.map((c) => c.low))

  if (newerHigh > olderHigh && newerLow > olderLow) return 'bullish'
  if (newerHigh < olderHigh && newerLow < olderLow) return 'bearish'
  return 'neutral'
}

/**
 * Higher-timeframe market regime (bullish/bearish/neutral/range) from EMA stack + slope AND price
 * structure (higher-highs/higher-lows or lower-highs/lower-lows). Both must agree — an EMA stack
 * without a matching swing structure (or vice versa) is treated as a range: no aggressive signals
 * in a sideways or indecisive market, per the prudent-mode philosophy.
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

  const structure = detectSwingStructure(candles, config.structureSwingLookback)

  const emaBullish = price > ema200 && ema20 > ema50 && ema20Slope > 0 && ema50Slope > 0
  const emaBearish = price < ema200 && ema20 < ema50 && ema20Slope < 0 && ema50Slope < 0

  const bullish = emaBullish && structure === 'bullish'
  const bearish = emaBearish && structure === 'bearish'

  return {
    regime: bullish ? 'bullish' : bearish ? 'bearish' : 'neutral',
    price,
    ema20,
    ema50,
    ema200,
    ema20Slope,
    ema50Slope,
    structure,
  }
}
