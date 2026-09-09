import type { BreakoutInfo, Candle, PullbackInfo, TradeDirection } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

/**
 * Scans backward from the most recent closed candle for the latest breakout of a swing
 * high/low formed over `swingLookback` prior bars, restricted to `direction` (the 15m regime
 * bias) so we never chase a breakout against the higher-timeframe trend. Only breakouts within
 * the last `pullbackMaxBars` are considered "recent" — older ones can no longer form a valid
 * pullback setup.
 */
export function findRecentBreakout(
  candles: Candle[],
  config: StrategyConfig,
  direction: TradeDirection,
): BreakoutInfo | null {
  const { swingLookback, pullbackMaxBars } = config
  const n = candles.length
  if (n < swingLookback + 1) return null

  const searchStart = n - 1
  const searchEnd = Math.max(swingLookback, n - 1 - pullbackMaxBars)

  for (let i = searchStart; i >= searchEnd; i--) {
    const window = candles.slice(i - swingLookback, i)
    if (window.length < swingLookback) continue
    const c = candles[i]

    if (direction === 'long') {
      const swingHigh = Math.max(...window.map((w) => w.high))
      if (c.close > swingHigh) {
        return { direction: 'long', level: swingHigh, breakoutIndex: i, breakoutClose: c.close }
      }
    } else {
      const swingLow = Math.min(...window.map((w) => w.low))
      if (c.close < swingLow) {
        return { direction: 'short', level: swingLow, breakoutIndex: i, breakoutClose: c.close }
      }
    }
  }
  return null
}

/**
 * A pullback is confirmed when, after the breakout bar, price retests the broken level (now
 * acting as support for a long / resistance for a short) and the level *holds*: the latest
 * closed candle is still back on the breakout side of the level.
 */
export function detectPullback(candles: Candle[], breakout: BreakoutInfo): PullbackInfo {
  const after = candles.slice(breakout.breakoutIndex + 1)
  if (after.length === 0) return { confirmed: false, pullbackIndex: -1, retestPrice: 0 }

  const level = breakout.level
  let pullbackIndex = -1
  let retestPrice = 0

  for (let j = 0; j < after.length; j++) {
    const c = after[j]
    if (breakout.direction === 'long' && c.low <= level) {
      pullbackIndex = breakout.breakoutIndex + 1 + j
      retestPrice = c.low
    } else if (breakout.direction === 'short' && c.high >= level) {
      pullbackIndex = breakout.breakoutIndex + 1 + j
      retestPrice = c.high
    }
  }

  if (pullbackIndex === -1) return { confirmed: false, pullbackIndex: -1, retestPrice: 0 }

  const last = candles[candles.length - 1]
  const levelHolds = breakout.direction === 'long' ? last.close > level : last.close < level
  return { confirmed: levelHolds, pullbackIndex, retestPrice }
}
