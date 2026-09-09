import { describe, expect, it } from 'vitest'
import { findSetupCandidate, nextTargetZone } from '../levels'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import { candle } from './testUtils'
import type { Candle, Zone } from '../../../types/scalpSignal'

const config = { ...DEFAULT_STRATEGY_CONFIG, pullbackMaxBars: 5 }

function flat(count: number, price: number): Candle[] {
  return Array.from({ length: count }, (_, i) => candle(i, { open: price, high: price + 1, low: price - 1, close: price }))
}

describe('findSetupCandidate — ZONE_REACTION', () => {
  const support: Zone = { kind: 'support', low: 99, high: 100.5, touches: 2, lastTouchIndex: 3 }

  it('finds a long zone reaction when price has touched a significant support zone recently', () => {
    const candles = [
      ...flat(6, 105),
      candle(6, { open: 104, high: 104.5, low: 100, close: 103 }), // touches the support zone
      candle(7, { open: 103, high: 105, low: 99.5, close: 104.5 }), // reaction candle
    ]
    const result = findSetupCandidate(candles, [support], 'long', config)
    expect(result).not.toBeNull()
    expect(result?.setupType).toBe('ZONE_REACTION')
    expect(result?.zone).toBe(support)
    expect(result?.triggerIndex).toBe(6)
    expect(result?.reactionIndex).toBe(7)
  })

  it('returns null when price never touched any relevant zone', () => {
    const candles = flat(8, 105)
    expect(findSetupCandidate(candles, [support], 'long', config)).toBeNull()
  })
})

describe('findSetupCandidate — BREAKOUT_PULLBACK_RETEST', () => {
  const resistance: Zone = { kind: 'resistance', low: 100, high: 101, touches: 2, lastTouchIndex: 3 }

  it('finds a long breakout+pullback+retest once a broken resistance zone is retested', () => {
    const candles = [
      ...flat(5, 99),
      candle(5, { open: 100, high: 103.5, low: 99.8, close: 103 }), // breaks above the resistance zone
      candle(6, { open: 103, high: 103.2, low: 100.3, close: 101.5 }), // pulls back and retests the zone
      candle(7, { open: 101.5, high: 104, low: 101, close: 103.5 }), // reaction candle
    ]
    const result = findSetupCandidate(candles, [resistance], 'long', config)
    expect(result).not.toBeNull()
    expect(result?.setupType).toBe('BREAKOUT_PULLBACK_RETEST')
    expect(result?.triggerIndex).toBe(5)
    expect(result?.reactionIndex).toBe(7)
  })

  it('returns null when the broken zone was never retested', () => {
    const candles = [
      ...flat(5, 99),
      candle(5, { open: 100, high: 103.5, low: 99.8, close: 103 }),
      candle(6, { open: 103, high: 105, low: 102.5, close: 104 }), // keeps running, never comes back
      candle(7, { open: 104, high: 106, low: 103.5, close: 105 }),
    ]
    expect(findSetupCandidate(candles, [resistance], 'long', config)).toBeNull()
  })

  it('prefers ZONE_REACTION over BREAKOUT_PULLBACK_RETEST when both could apply', () => {
    const support: Zone = { kind: 'support', low: 99, high: 100.5, touches: 2, lastTouchIndex: 3 }
    const candles = [
      ...flat(5, 99),
      candle(5, { open: 100, high: 103.5, low: 99.8, close: 103 }),
      candle(6, { open: 103, high: 103.2, low: 100.3, close: 101.5 }),
      candle(7, { open: 101.5, high: 104, low: 100, close: 103.5 }), // also sits inside the support zone
    ]
    const result = findSetupCandidate(candles, [support, resistance], 'long', config)
    expect(result?.setupType).toBe('ZONE_REACTION')
  })
})

describe('nextTargetZone', () => {
  it('picks the nearest resistance ahead for a long, and support ahead for a short', () => {
    const support: Zone = { kind: 'support', low: 90, high: 91, touches: 2, lastTouchIndex: 1 }
    const resistance: Zone = { kind: 'resistance', low: 110, high: 111, touches: 2, lastTouchIndex: 2 }
    expect(nextTargetZone([support, resistance], 100, 'long')).toBe(resistance)
    expect(nextTargetZone([support, resistance], 100, 'short')).toBe(support)
  })
})
