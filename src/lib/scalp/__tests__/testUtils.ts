import type { Candle } from '../../../types/scalpSignal'

export function candle(
  i: number,
  data: { open: number; high: number; low: number; close: number; volume?: number },
  stepMs = 300_000,
): Candle {
  return {
    openTime: i * stepMs,
    open: data.open,
    high: data.high,
    low: data.low,
    close: data.close,
    volume: data.volume ?? 100,
    closeTime: i * stepMs + stepMs - 1,
  }
}

/** Flat-ish OHLC candles built from a closes array (open=prevClose, tight high/low band). */
export function candlesFromCloses(closes: number[], volumes?: number[], stepMs = 900_000): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]
    return candle(
      i,
      { open, close, high: Math.max(open, close) + 0.01, low: Math.min(open, close) - 0.01, volume: volumes?.[i] ?? 100 },
      stepMs,
    )
  })
}
