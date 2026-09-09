import { calculateMACD, calculateRSI } from '../indicators'
import type { Candle, ConfirmationInfo, PullbackInfo, TradeDirection } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

/**
 * We never enter on the breakout candle alone. After a confirmed pullback, at least two of
 * {candlestick rejection, volume spike, healthy RSI, MACD alignment} must agree with the trade
 * direction before the setup is considered confirmed.
 */
export function detectConfirmation(
  candles: Candle[],
  pullback: PullbackInfo,
  direction: TradeDirection,
  config: StrategyConfig,
): ConfirmationInfo {
  const last = candles[candles.length - 1]

  const body = Math.abs(last.close - last.open)
  const lowerWick = Math.min(last.open, last.close) - last.low
  const upperWick = last.high - Math.max(last.open, last.close)
  const candlestickRejection =
    direction === 'long' ? lowerWick > body && last.close >= last.open : upperWick > body && last.close <= last.open

  const recentVolumes = candles.slice(-config.swingLookback).map((c) => c.volume)
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / (recentVolumes.length || 1)
  const volumeConfirmed = avgVolume > 0 && last.volume >= avgVolume * config.volumeConfirmMult

  const closes = candles.map((c) => c.close)
  const rsi = calculateRSI(closes, config.rsiPeriod)
  const rsiConfirmed = direction === 'long' ? rsi > 45 && rsi < 78 : rsi < 55 && rsi > 22

  const macd = calculateMACD(closes)
  const macdConfirmed = direction === 'long' ? macd.histogram > 0 : macd.histogram < 0

  const confirmedCount = [candlestickRejection, volumeConfirmed, rsiConfirmed, macdConfirmed].filter(Boolean).length
  const confirmed = pullback.confirmed && confirmedCount >= 2

  return { confirmed, candlestickRejection, volumeConfirmed, rsiConfirmed, macdConfirmed }
}
