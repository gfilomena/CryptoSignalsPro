import { calculateMACD, calculateRSI } from '../indicators'
import type { Candle, ConfirmationInfo, TradeDirection, Zone } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

/**
 * The only mandatory gate is price structure: the most recent candle must show a rejection wick
 * against the zone and close back beyond it (reclaim for a long, breakdown for a short). RSI,
 * MACD and volume are deliberately secondary — they can never create a signal on their own, only
 * add confidence to a structurally confirmed setup (prudent-mode philosophy).
 */
export function detectConfirmation(candles: Candle[], zone: Zone, direction: TradeDirection, config: StrategyConfig): ConfirmationInfo {
  const last = candles[candles.length - 1]

  const body = Math.abs(last.close - last.open)
  const lowerWick = Math.min(last.open, last.close) - last.low
  const upperWick = last.high - Math.max(last.open, last.close)
  const candlestickRejection =
    direction === 'long' ? lowerWick > body && last.close >= last.open : upperWick > body && last.close <= last.open

  const reclaimLevel = direction === 'long' ? zone.high : zone.low
  const reclaimClose = direction === 'long' ? last.close > reclaimLevel : last.close < reclaimLevel

  // Secondary boosters — informational only, never part of the mandatory gate below.
  const recentVolumes = candles.slice(-config.swingLookback).map((c) => c.volume)
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / (recentVolumes.length || 1)
  const volumeConfirmed = avgVolume > 0 && last.volume >= avgVolume * config.volumeConfirmMult

  const closes = candles.map((c) => c.close)
  const rsi = calculateRSI(closes, config.rsiPeriod)
  const rsiConfirmed = direction === 'long' ? rsi > 45 && rsi < 78 : rsi < 55 && rsi > 22

  const macd = calculateMACD(closes)
  const macdConfirmed = direction === 'long' ? macd.histogram > 0 : macd.histogram < 0

  return {
    confirmed: candlestickRejection && reclaimClose,
    candlestickRejection,
    reclaimClose,
    volumeConfirmed,
    rsiConfirmed,
    macdConfirmed,
  }
}
