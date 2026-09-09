import { describe, expect, it } from 'vitest'
import { evaluateSetup } from '../strategyEngine'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import { candle, candlesFromCloses } from './testUtils'

const config = {
  ...DEFAULT_STRATEGY_CONFIG,
  emaFast: 5,
  emaMedium: 10,
  emaSlow: 20,
  swingLookback: 5,
  pullbackMaxBars: 5,
  rsiPeriod: 5,
  atrPeriod: 5,
}

function bullishTrendCandles() {
  return candlesFromCloses(Array.from({ length: 25 }, (_, i) => 100 + i))
}

function breakoutPullbackEntryCandles() {
  return [
    ...candlesFromCloses([100, 100, 100, 100, 100, 100]),
    candle(5, { open: 100, high: 105, low: 100, close: 104, volume: 120 }), // breakout, level~101
    candle(6, { open: 101, high: 102.3, low: 99.5, close: 102, volume: 140 }), // pullback + confirmation
  ]
}

describe('evaluateSetup (strategy engine)', () => {
  it('produces a confirmed long setup when trend + breakout + pullback + confirmation align', () => {
    const result = evaluateSetup({
      symbol: 'BTC',
      trendCandles: bullishTrendCandles(),
      entryCandles: breakoutPullbackEntryCandles(),
      config,
    })
    expect(result.regime).toBe('bullish')
    expect(result.setup).not.toBeNull()
    expect(result.setup?.direction).toBe('long')
    expect(result.setup?.confirmation.confirmed).toBe(true)
    expect(result.setup?.entryPrice).toBe(102)
  })

  it('is NO TRADE when the 15m regime is neutral, even with a clean 5m breakout', () => {
    const flatTrend = candlesFromCloses(Array.from({ length: 25 }, () => 100))
    const result = evaluateSetup({
      symbol: 'BTC',
      trendCandles: flatTrend,
      entryCandles: breakoutPullbackEntryCandles(),
      config,
    })
    expect(result.regime).toBe('neutral')
    expect(result.setup).toBeNull()
  })

  it('is NO TRADE when there is no breakout yet, even in a trending regime', () => {
    const result = evaluateSetup({
      symbol: 'BTC',
      trendCandles: bullishTrendCandles(),
      entryCandles: candlesFromCloses([100, 100, 100, 100, 100, 100, 100]),
      config,
    })
    expect(result.setup).toBeNull()
    expect(result.reasons).toContain('no_breakout')
  })
})
