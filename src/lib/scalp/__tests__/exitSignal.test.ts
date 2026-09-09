import { describe, expect, it } from 'vitest'
import { detectExitSignal } from '../exitSignal'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import { candle, candlesFromCloses } from './testUtils'

const config = { ...DEFAULT_STRATEGY_CONFIG, rsiPeriod: 5 }

function longRunUp(): number[] {
  return Array.from({ length: 26 }, (_, i) => 100 + i) // reaches 125, enough history for MACD
}

function sharpDecline(from: number, steps: number): number[] {
  const out: number[] = []
  let price = from
  for (let i = 0; i < steps; i++) {
    price -= price * 0.06
    out.push(Math.round(price * 100) / 100)
  }
  return out
}

describe('detectExitSignal', () => {
  it('suggests closing a long position once candlestick + RSI + MACD all turn against it', () => {
    const closes = [...longRunUp(), ...sharpDecline(125, 14)]
    const lastClose = closes[closes.length - 1]
    const candles = [
      ...candlesFromCloses(closes),
      // upper-wick rejection candle closing red, right after the decline
      candle(closes.length, { open: lastClose, high: lastClose * 1.15, low: lastClose * 0.85, close: lastClose * 0.92 }),
    ]
    const result = detectExitSignal(candles, 'long', config)
    expect(result.candlestickReversal).toBe(true)
    expect(result.rsiReversal).toBe(true)
    expect(result.macdReversal).toBe(true)
    expect(result.suggested).toBe(true)
  })

  it('mirrors the logic for a short position (rally against it)', () => {
    const closes = [...longRunUp().map((c) => 250 - c), ...sharpDecline(125, 14).map((c) => 250 - c)]
    const lastClose = closes[closes.length - 1]
    const candles = [
      ...candlesFromCloses(closes),
      // lower-wick rejection candle closing green, right after the rally
      candle(closes.length, { open: lastClose, high: lastClose * 1.15, low: lastClose * 0.85, close: lastClose * 1.08 }),
    ]
    const result = detectExitSignal(candles, 'short', config)
    expect(result.candlestickReversal).toBe(true)
    expect(result.rsiReversal).toBe(true)
    expect(result.macdReversal).toBe(true)
    expect(result.suggested).toBe(true)
  })

  it('does not suggest an exit on a single weak signal alone', () => {
    // Steady uptrend with only a marginal last candle — RSI/MACD both still firmly aligned
    // with the long position, so even if the candle looks a bit off it must not be enough alone.
    const candles = candlesFromCloses(Array.from({ length: 30 }, (_, i) => 100 + i))
    const result = detectExitSignal(candles, 'long', config)
    expect(result.suggested).toBe(false)
  })
})
