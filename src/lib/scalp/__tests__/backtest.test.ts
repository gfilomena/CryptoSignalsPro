import { describe, expect, it } from 'vitest'
import { runBacktest } from '../backtest'
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
  // Relaxed so this test exercises the backtest loop's mechanics (no-look-ahead walk-forward,
  // trade open/close bookkeeping, stats aggregation) rather than re-verifying the ATR guard or
  // confidence-score arithmetic, which already have their own dedicated unit tests.
  maxStopAtr: 100,
  minSignalConfidence: 0,
}

// Higher-timeframe candles never change during the walk: closeTime is pinned to 0 so every step
// of the entry-timeframe loop always sees the full history (the loop's own `closeTime <= cutoff`
// filter is what implements no-look-ahead; this just keeps the fixture simple).
function pinned(candles: Candle[]): Candle[] {
  return candles.map((c) => ({ ...c, closeTime: 0 }))
}

function bullishTrendCandles(): Candle[] {
  return pinned(candlesFromCloses(Array.from({ length: 25 }, (_, i) => 100 + i)))
}

function supportStructureCandles(): Candle[] {
  const lows = [120, 115, 110, 105, 100, 105, 110, 115, 120, 115, 110, 105, 100, 105, 110, 115, 90, 115, 110, 105, 100]
  return pinned(lows.map((low, i) => candle(i, { open: low + 5, close: low + 5, high: low + 10, low })))
}

describe('runBacktest', () => {
  it('opens exactly one trade on a clean setup and closes it as a winner once price runs to target', () => {
    const padding = Array.from({ length: 22 }, (_, i) => candle(i, { open: 105, high: 106, low: 104, close: 105 }))
    const entryCandles: Candle[] = [
      ...padding,
      candle(22, { open: 104, high: 104.5, low: 100, close: 103 }), // touches the support zone
      candle(23, { open: 101, high: 103, low: 99.3, close: 101.5 }), // rejection + reclaim -> CONFIRMED
      candle(24, { open: 102, high: 130, low: 101, close: 128 }), // runs hard toward target
      candle(25, { open: 128, high: 160, low: 127, close: 155 }), // clears any realistic TP
    ]

    const result = runBacktest(bullishTrendCandles(), supportStructureCandles(), entryCandles, config)

    expect(result.trades).toHaveLength(1)
    expect(result.trades[0].direction).toBe('long')
    expect(result.trades[0].result).not.toBe('OPEN')
    expect(['TP1', 'TP2']).toContain(result.trades[0].result)
    expect(result.trades[0].pnl).toBeGreaterThan(0)
    expect(result.stats.totalTrades).toBe(1)
    expect(result.stats.wins).toBe(1)
  })

  it('takes no trades at all over a purely ranging market — NO TRADE is the default outcome', () => {
    const flatEntry = candlesFromCloses(Array.from({ length: 40 }, () => 100))
    const flatTrend = pinned(candlesFromCloses(Array.from({ length: 25 }, () => 100))) // no regime
    const result = runBacktest(flatTrend, supportStructureCandles(), flatEntry, config)

    expect(result.trades).toHaveLength(0)
    expect(result.stats.totalTrades).toBe(0)
    expect(result.noTradeDays).toBe(result.totalDays)
  })
})
