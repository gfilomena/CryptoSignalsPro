import { calculateMACD, calculateRSI } from '../indicators'
import type { Candle, ExitSignalInfo, TradeDirection } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

/**
 * Discretionary "consider closing early" signal for an already-open trade — mirrors
 * confirmation.ts's entry logic but inverted: a rejection candle, RSI or MACD turning against the
 * position direction. This never closes the paper trade itself (only STOP_HIT/TP1_HIT/TP2_HIT
 * do that) and is never a single indicator alone — at least 2 of the 3 must agree, same
 * "no single indicator decides" philosophy used for entries.
 */
export function detectExitSignal(candles: Candle[], direction: TradeDirection, config: StrategyConfig): ExitSignalInfo {
  const last = candles[candles.length - 1]

  const body = Math.abs(last.close - last.open)
  const lowerWick = Math.min(last.open, last.close) - last.low
  const upperWick = last.high - Math.max(last.open, last.close)
  // Rejection AGAINST the position: for a long, an upper-wick rejection that closes red.
  const candlestickReversal =
    direction === 'long' ? upperWick > body && last.close <= last.open : lowerWick > body && last.close >= last.open

  const closes = candles.map((c) => c.close)
  const rsi = calculateRSI(closes, config.rsiPeriod)
  const rsiReversal = direction === 'long' ? rsi < 45 : rsi > 55

  const macd = calculateMACD(closes)
  const macdReversal = direction === 'long' ? macd.histogram < 0 : macd.histogram > 0

  const count = [candlestickReversal, rsiReversal, macdReversal].filter(Boolean).length
  return { suggested: count >= 2, candlestickReversal, rsiReversal, macdReversal }
}
