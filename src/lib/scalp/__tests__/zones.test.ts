import { describe, expect, it } from 'vitest'
import { detectZones, nearestZoneAhead, priceBrokeZone, priceInZone } from '../zones'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import { candle } from './testUtils'
import type { Candle } from '../../../types/scalpSignal'

const config = { ...DEFAULT_STRATEGY_CONFIG, zonePivotWindow: 2, zoneMinTouches: 2, zoneClusterPct: 0.5, zoneLookback: 100 }

function candlesFromExtremes(lows: number[], highs: number[]): Candle[] {
  return lows.map((low, i) => {
    const high = highs[i]
    const mid = (low + high) / 2
    return candle(i, { open: mid, close: mid, high, low })
  })
}

describe('detectZones', () => {
  it('builds a support zone from a level tested more than once, ignoring a single isolated dip', () => {
    // Support at 100 touched at index 4 and 12; an isolated one-off dip to 90 at index 16 must
    // not become a zone (only tested once).
    const lows = [120, 115, 110, 105, 100, 105, 110, 115, 120, 115, 110, 105, 100, 105, 110, 115, 90, 115, 110, 105, 100]
    const highs = lows.map((l) => l + 10)
    const zones = detectZones(candlesFromExtremes(lows, highs), config)

    const supports = zones.filter((z) => z.kind === 'support')
    expect(supports).toHaveLength(1)
    expect(supports[0].low).toBeLessThanOrEqual(100)
    expect(supports[0].high).toBeGreaterThanOrEqual(100)
    expect(supports[0].touches).toBe(2)
    expect(zones.some((z) => z.low <= 90 && z.high >= 90)).toBe(false)
  })

  it('builds a resistance zone from a level tested more than once', () => {
    const highs = [80, 85, 90, 95, 100, 95, 90, 85, 80, 85, 90, 95, 100, 95, 90, 85, 80]
    const lows = highs.map((h) => h - 10)
    const zones = detectZones(candlesFromExtremes(lows, highs), config)

    const resistances = zones.filter((z) => z.kind === 'resistance')
    expect(resistances).toHaveLength(1)
    expect(resistances[0].touches).toBe(2)
  })

  it('returns no zones when there is not enough data', () => {
    const zones = detectZones(candlesFromExtremes([100, 101, 102], [110, 111, 112]), config)
    expect(zones).toHaveLength(0)
  })
})

describe('priceInZone / priceBrokeZone / nearestZoneAhead', () => {
  const support = { kind: 'support' as const, low: 99, high: 101, touches: 2, lastTouchIndex: 10 }
  const resistance = { kind: 'resistance' as const, low: 119, high: 121, touches: 3, lastTouchIndex: 20 }

  it('detects when price sits inside a zone', () => {
    expect(priceInZone(support, 100)).toBe(true)
    expect(priceInZone(support, 105)).toBe(false)
  })

  it('detects a decisive break beyond a zone', () => {
    expect(priceBrokeZone(resistance, 122, 'long')).toBe(true)
    expect(priceBrokeZone(resistance, 120, 'long')).toBe(false)
    expect(priceBrokeZone(support, 98, 'short')).toBe(true)
  })

  it('finds the nearest opposing zone ahead of price', () => {
    const near = nearestZoneAhead([support, resistance], 'resistance', 105, 'long')
    expect(near).toBe(resistance)
    expect(nearestZoneAhead([support], 'resistance', 105, 'long')).toBeNull()
  })
})
