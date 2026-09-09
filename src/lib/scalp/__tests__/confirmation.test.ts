import { describe, expect, it } from 'vitest'
import { detectConfirmation } from '../confirmation'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import { candle, candlesFromCloses } from './testUtils'
import type { Candle, PullbackInfo } from '../../../types/scalpSignal'

const config = { ...DEFAULT_STRATEGY_CONFIG, swingLookback: 5, rsiPeriod: 5 }

const confirmedPullback: PullbackInfo = { confirmed: true, pullbackIndex: 6, retestPrice: 99.5 }
const unconfirmedPullback: PullbackInfo = { confirmed: false, pullbackIndex: -1, retestPrice: 0 }

function baseCandles(): Candle[] {
  return [
    ...candlesFromCloses([100, 100, 100, 100, 100, 100]),
    // strong lower-wick rejection + volume spike on the last (confirmation) candle
    candle(6, { open: 101, high: 102.3, low: 99.5, close: 102, volume: 140 }),
  ]
}

describe('detectConfirmation', () => {
  it('confirms a long setup when at least 2 signals agree (rejection + volume)', () => {
    const result = detectConfirmation(baseCandles(), confirmedPullback, 'long', config)
    expect(result.candlestickRejection).toBe(true)
    expect(result.volumeConfirmed).toBe(true)
    expect(result.confirmed).toBe(true)
  })

  it('never confirms without a confirmed pullback, however strong the candle', () => {
    const result = detectConfirmation(baseCandles(), unconfirmedPullback, 'long', config)
    expect(result.confirmed).toBe(false)
  })

  it('does not confirm on a single weak signal alone (no chasing the breakout candle)', () => {
    const weak = [
      ...candlesFromCloses([100, 100, 100, 100, 100, 100]),
      candle(6, { open: 100, high: 100.5, low: 99.9, close: 100.2, volume: 101 }),
    ]
    const result = detectConfirmation(weak, confirmedPullback, 'long', config)
    expect(result.confirmed).toBe(false)
  })
})
