import { calculateATR, calculateMACD, calculateRSI } from '../indicators'
import { detectRegime, type RegimeResult } from './regime'
import { findRecentBreakout, detectPullback } from './levels'
import { detectConfirmation } from './confirmation'
import type { Candle, MarketRegime, ScalpSetup } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

export interface StrategyEngineInput {
  symbol: string
  /** Higher timeframe (default 15m) — used only for market regime. */
  trendCandles: Candle[]
  /** Lower timeframe (default 5m) — used for breakout/pullback/confirmation/entry. */
  entryCandles: Candle[]
  config: StrategyConfig
}

export interface StrategyEngineResult {
  setup: ScalpSetup | null
  regime: MarketRegime
  regimeDetail: RegimeResult
  reasons: string[]
}

/**
 * Pure rule-based strategy engine: no I/O, no side effects, no global state. Given klines for
 * both timeframes it returns a concrete ScalpSetup or null (NO TRADE). Designed to be callable
 * identically from the live client, a server-side scheduled cycle, paper trading, and — in the
 * future — a historical backtest, without any rewrite.
 */
export function evaluateSetup(input: StrategyEngineInput): StrategyEngineResult {
  const { symbol, trendCandles, entryCandles, config } = input
  const reasons: string[] = []

  const regimeDetail = detectRegime(trendCandles, config)
  if (regimeDetail.regime === 'neutral') {
    reasons.push('regime_neutral')
    return { setup: null, regime: 'neutral', regimeDetail, reasons }
  }
  const direction = regimeDetail.regime === 'bullish' ? 'long' : 'short'
  reasons.push(regimeDetail.regime === 'bullish' ? 'trend_15m_bullish' : 'trend_15m_bearish')

  if (entryCandles.length < config.swingLookback + 2) {
    reasons.push('insufficient_entry_data')
    return { setup: null, regime: regimeDetail.regime, regimeDetail, reasons }
  }

  const breakout = findRecentBreakout(entryCandles, config, direction)
  if (!breakout) {
    reasons.push('no_breakout')
    return { setup: null, regime: regimeDetail.regime, regimeDetail, reasons }
  }
  reasons.push('breakout_detected')

  const pullback = detectPullback(entryCandles, breakout)
  if (!pullback.confirmed) {
    reasons.push('pullback_not_confirmed')
    return { setup: null, regime: regimeDetail.regime, regimeDetail, reasons }
  }
  reasons.push('pullback_confirmed')

  // Breakout + pullback are structural (setup exists from here on); confirmation quality is
  // carried on the setup itself so the state machine can distinguish SETUP (unconfirmed) from
  // CONFIRMED (ready to trade) without the engine re-running.
  const confirmation = detectConfirmation(entryCandles, pullback, direction, config)
  if (!confirmation.confirmed) reasons.push('confirmation_missing')
  if (confirmation.candlestickRejection) reasons.push('candlestick_confirmation')
  if (confirmation.volumeConfirmed) reasons.push('volume_confirmation')
  if (confirmation.rsiConfirmed) reasons.push('rsi_healthy')
  if (confirmation.macdConfirmed) reasons.push(direction === 'long' ? 'macd_bullish' : 'macd_bearish')

  const last = entryCandles[entryCandles.length - 1]
  const closes = entryCandles.map((c) => c.close)
  const klineRows = entryCandles.map((c) => [c.openTime, c.open, c.high, c.low, c.close, c.volume])
  const atr = calculateATR(klineRows, config.atrPeriod)
  const atrPct = last.close > 0 ? (atr / last.close) * 100 : 0
  const rsi = calculateRSI(closes, config.rsiPeriod)
  const macd = calculateMACD(closes)
  const recentVolumes = entryCandles.slice(-config.swingLookback).map((c) => c.volume)
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / (recentVolumes.length || 1)
  const volumeRatio = avgVolume > 0 ? last.volume / avgVolume : 1

  const pullbackLeg = entryCandles.slice(breakout.breakoutIndex + 1, pullback.pullbackIndex + 1)
  const stopCandidate =
    direction === 'long'
      ? Math.min(breakout.level, ...pullbackLeg.map((c) => c.low))
      : Math.max(breakout.level, ...pullbackLeg.map((c) => c.high))

  const setup: ScalpSetup = {
    symbol,
    direction,
    regime: regimeDetail.regime,
    breakout,
    pullback,
    confirmation,
    entryPrice: last.close,
    stopCandidate,
    atr,
    atrPct,
    rsi,
    macdHistogram: macd.histogram,
    volumeRatio,
    timestamp: last.closeTime,
  }

  return { setup, regime: regimeDetail.regime, regimeDetail, reasons }
}
