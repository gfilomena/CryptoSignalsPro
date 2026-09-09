import { describe, expect, it } from 'vitest'
import { evaluateSetup } from '../strategyEngine'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import { candle, candlesFromCloses } from './testUtils'
import type { Candle } from '../../../types/scalpSignal'

const config = {
  ...DEFAULT_STRATEGY_CONFIG,
  emaFast: 5,
  emaMedium: 10,
  emaSlow: 20,
  swingLookback: 5,
  pullbackMaxBars: 5,
  rsiPeriod: 5,
  atrPeriod: 5,
  zonePivotWindow: 1,
  zoneMinTouches: 2,
  zoneClusterPct: 0.5,
  zoneLookback: 100,
}

function bullishTrendCandles() {
  return candlesFromCloses(Array.from({ length: 25 }, (_, i) => 100 + i))
}

/** 1h structure candles with a support zone at price ~100 tested twice (indices 4 and 12), and
 * one isolated dip that must not become a zone — same pattern validated in zones.test.ts. */
function supportStructureCandles(): Candle[] {
  const lows = [120, 115, 110, 105, 100, 105, 110, 115, 120, 115, 110, 105, 100, 105, 110, 115, 90, 115, 110, 105, 100]
  return lows.map((low, i) => candle(i, { open: low + 5, close: low + 5, high: low + 10, low }))
}

/** 15m entry candles: price sits above the zone, touches it once (index 6), then the final
 * candle shows a rejection wick that reclaims back above the zone's top edge. */
function zoneReactionEntryCandles(): Candle[] {
  return [
    ...Array.from({ length: 6 }, (_, i) => candle(i, { open: 105, high: 106, low: 104, close: 105 })),
    candle(6, { open: 104, high: 104.5, low: 100, close: 103 }), // touches the support zone
    candle(7, { open: 101, high: 103, low: 99.3, close: 101.5 }), // rejection wick + reclaim close
  ]
}

describe('evaluateSetup (strategy engine)', () => {
  it('produces a confirmed long setup when 4h trend + 1h zone + 15m reaction align', () => {
    const result = evaluateSetup({
      symbol: 'BTC',
      trendCandles: bullishTrendCandles(),
      structureCandles: supportStructureCandles(),
      entryCandles: zoneReactionEntryCandles(),
      config,
    })
    expect(result.regime).toBe('bullish')
    expect(result.zones.length).toBeGreaterThan(0)
    expect(result.setup).not.toBeNull()
    expect(result.setup?.direction).toBe('long')
    expect(result.setup?.setupType).toBe('ZONE_REACTION')
    expect(result.setup?.confirmation.confirmed).toBe(true)
    expect(result.setup?.entryPrice).toBe(101.5)
  })

  it('is NO TRADE when the 4h regime is ranging, even with a valid zone reaction', () => {
    const flatTrend = candlesFromCloses(Array.from({ length: 25 }, () => 100))
    const result = evaluateSetup({
      symbol: 'BTC',
      trendCandles: flatTrend,
      structureCandles: supportStructureCandles(),
      entryCandles: zoneReactionEntryCandles(),
      config,
    })
    expect(result.regime).toBe('neutral')
    expect(result.setup).toBeNull()
    expect(result.reasons).toContain('regime_range')
  })

  it('is NO TRADE when no 1h zone has been tested enough yet', () => {
    // A strictly monotonic series never repeats a high/low, so no pivot ever gets a second
    // touch — no zone can form, unlike a flat series where every candle degenerately "touches".
    const noZones = candlesFromCloses(Array.from({ length: 25 }, (_, i) => 100 + i))
    const result = evaluateSetup({
      symbol: 'BTC',
      trendCandles: bullishTrendCandles(),
      structureCandles: noZones,
      entryCandles: zoneReactionEntryCandles(),
      config,
    })
    expect(result.setup).toBeNull()
    expect(result.reasons).toContain('no_significant_zones')
  })

  it('is NO TRADE when the trend is bullish but price never reacted at any zone', () => {
    const noTouch = Array.from({ length: 8 }, (_, i) => candle(i, { open: 105, high: 106, low: 104, close: 105 }))
    const result = evaluateSetup({
      symbol: 'BTC',
      trendCandles: bullishTrendCandles(),
      structureCandles: supportStructureCandles(),
      entryCandles: noTouch,
      config,
    })
    expect(result.setup).toBeNull()
    expect(result.reasons).toContain('no_structure_setup')
  })
})
