import { describe, expect, it } from 'vitest'
import { detectConfirmation } from '../confirmation'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import { candle, candlesFromCloses } from './testUtils'
import type { Candle, Zone } from '../../../types/scalpSignal'

const config = { ...DEFAULT_STRATEGY_CONFIG, swingLookback: 5, rsiPeriod: 5 }

const supportZone: Zone = { kind: 'support', low: 99, high: 100.5, touches: 2, lastTouchIndex: 3 }

function baseCandles(): Candle[] {
  return [
    ...candlesFromCloses([100, 100, 100, 100, 100, 100]),
    // strong lower-wick rejection that reclaims back above the zone's top edge
    candle(6, { open: 101, high: 102.3, low: 99.5, close: 102, volume: 140 }),
  ]
}

describe('detectConfirmation', () => {
  it('confirms a long setup on rejection + reclaim close beyond the zone', () => {
    const result = detectConfirmation(baseCandles(), supportZone, 'long', config)
    expect(result.candlestickRejection).toBe(true)
    expect(result.reclaimClose).toBe(true)
    expect(result.confirmed).toBe(true)
  })

  it('never confirms without a reclaim close, however strong the rejection wick', () => {
    const notReclaimedYet: Zone = { ...supportZone, high: 103 } // close (102) is still below this
    const result = detectConfirmation(baseCandles(), notReclaimedYet, 'long', config)
    expect(result.candlestickRejection).toBe(true)
    expect(result.reclaimClose).toBe(false)
    expect(result.confirmed).toBe(false)
  })

  it('does not confirm on a weak candle with no rejection wick, even if volume is secondary-confirmed', () => {
    const weak = [
      ...candlesFromCloses([100, 100, 100, 100, 100, 100]),
      candle(6, { open: 100, high: 100.5, low: 99.9, close: 100.2, volume: 200 }),
    ]
    const result = detectConfirmation(weak, supportZone, 'long', config)
    expect(result.candlestickRejection).toBe(false)
    expect(result.confirmed).toBe(false)
  })

  it('RSI/MACD/volume never gate the signal alone — only the structural rejection+reclaim does', () => {
    // Rejection + reclaim both true, but volume is below average and RSI/MACD may or may not
    // align — confirmed must stay true regardless (secondary signals are informational only).
    const lowVolume = [
      ...candlesFromCloses([100, 100, 100, 100, 100, 100], [500, 500, 500, 500, 500, 500]),
      candle(6, { open: 101, high: 102.3, low: 99.5, close: 102, volume: 1 }),
    ]
    const result = detectConfirmation(lowVolume, supportZone, 'long', config)
    expect(result.volumeConfirmed).toBe(false)
    expect(result.confirmed).toBe(true)
  })
})
