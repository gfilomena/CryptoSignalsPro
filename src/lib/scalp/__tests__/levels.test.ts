import { describe, expect, it } from 'vitest'
import { detectPullback, findRecentBreakout } from '../levels'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import { candle } from './testUtils'
import type { Candle } from '../../../types/scalpSignal'

const config = { ...DEFAULT_STRATEGY_CONFIG, swingLookback: 5, pullbackMaxBars: 5 }

function consolidation(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => candle(i, { open: 100, high: 101, low: 99, close: 100, volume: 100 }))
}

describe('findRecentBreakout', () => {
  it('finds a long breakout above the recent swing high', () => {
    const candles = [...consolidation(5), candle(5, { open: 100, high: 105, low: 100, close: 104, volume: 120 })]
    const breakout = findRecentBreakout(candles, config, 'long')
    expect(breakout).not.toBeNull()
    expect(breakout?.direction).toBe('long')
    expect(breakout?.level).toBeCloseTo(101)
    expect(breakout?.breakoutIndex).toBe(5)
  })

  it('finds a short breakout below the recent swing low', () => {
    const candles = [...consolidation(5), candle(5, { open: 100, high: 100, low: 95, close: 96, volume: 120 })]
    const breakout = findRecentBreakout(candles, config, 'short')
    expect(breakout).not.toBeNull()
    expect(breakout?.direction).toBe('short')
    expect(breakout?.level).toBeCloseTo(99)
  })

  it('returns null when price stays inside the range', () => {
    const candles = consolidation(10)
    expect(findRecentBreakout(candles, config, 'long')).toBeNull()
  })

  it('ignores a breakout that happened too long ago', () => {
    const old = [...consolidation(5), candle(5, { open: 100, high: 105, low: 100, close: 104, volume: 120 })]
    const stale = [...old, ...consolidation(10).map((c, i) => candle(6 + i, { ...c, close: 100 }))]
    expect(findRecentBreakout(stale, config, 'long')).toBeNull()
  })
})

describe('detectPullback', () => {
  it('confirms a pullback that retests the level and holds', () => {
    const candles = [
      ...consolidation(5),
      candle(5, { open: 100, high: 105, low: 100, close: 104, volume: 120 }), // breakout, level=101
      candle(6, { open: 101, high: 102.3, low: 99.5, close: 102, volume: 140 }), // retest + hold
    ]
    const breakout = findRecentBreakout(candles, config, 'long')!
    const pullback = detectPullback(candles, breakout)
    expect(pullback.confirmed).toBe(true)
    expect(pullback.pullbackIndex).toBe(6)
  })

  it('does not confirm when price never retests the level', () => {
    const candles = [
      ...consolidation(5),
      candle(5, { open: 100, high: 105, low: 100, close: 104, volume: 120 }),
      candle(6, { open: 104, high: 106, low: 103.5, close: 105, volume: 100 }),
    ]
    const breakout = findRecentBreakout(candles, config, 'long')!
    const pullback = detectPullback(candles, breakout)
    expect(pullback.confirmed).toBe(false)
  })

  it('does not confirm when the level fails to hold on the retest', () => {
    const candles = [
      ...consolidation(5),
      candle(5, { open: 100, high: 105, low: 100, close: 104, volume: 120 }),
      candle(6, { open: 101, high: 101.5, low: 98, close: 99, volume: 100 }), // closes back below the level
    ]
    const breakout = findRecentBreakout(candles, config, 'long')!
    const pullback = detectPullback(candles, breakout)
    expect(pullback.confirmed).toBe(false)
  })
})
