import { calculateATR, calculateMACD, calculateRSI } from '../indicators'
import { detectRegime, type RegimeResult } from './regime'
import { detectZones } from './zones'
import { findSetupCandidate } from './levels'
import { detectConfirmation } from './confirmation'
import type { Candle, MarketRegime, ScalpSetup, Zone } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

export interface StrategyEngineInput {
  symbol: string
  /** Market regime timeframe (default 4h). */
  trendCandles: Candle[]
  /** Support/resistance structure timeframe (default 1h). */
  structureCandles: Candle[]
  /** Entry confirmation timeframe (default 15m). */
  entryCandles: Candle[]
  config: StrategyConfig
}

export interface StrategyEngineResult {
  setup: ScalpSetup | null
  regime: MarketRegime
  regimeDetail: RegimeResult
  zones: Zone[]
  reasons: string[]
}

/**
 * Pure rule-based strategy engine: no I/O, no side effects, no global state. Priority order:
 * regime -> significant structure zones -> price reaction/structure -> mandatory confirmation ->
 * (risk/reward is decided downstream by the risk engine). Given klines for all three timeframes
 * it returns a concrete ScalpSetup or null (NO TRADE) — prudent by default: any missing link in
 * the chain stops the search immediately rather than settling for a weaker signal.
 */
export function evaluateSetup(input: StrategyEngineInput): StrategyEngineResult {
  const { symbol, trendCandles, structureCandles, entryCandles, config } = input
  const reasons: string[] = []

  const regimeDetail = detectRegime(trendCandles, config)
  if (regimeDetail.regime === 'neutral') {
    reasons.push('regime_range')
    return { setup: null, regime: 'neutral', regimeDetail, zones: [], reasons }
  }
  const direction = regimeDetail.regime === 'bullish' ? 'long' : 'short'
  reasons.push(regimeDetail.regime === 'bullish' ? 'trend_4h_bullish' : 'trend_4h_bearish')

  const zones = detectZones(structureCandles, config)
  if (zones.length === 0) {
    reasons.push('no_significant_zones')
    return { setup: null, regime: regimeDetail.regime, regimeDetail, zones, reasons }
  }

  if (entryCandles.length < config.pullbackMaxBars + 3) {
    reasons.push('insufficient_entry_data')
    return { setup: null, regime: regimeDetail.regime, regimeDetail, zones, reasons }
  }

  const candidate = findSetupCandidate(entryCandles, zones, direction, config)
  if (!candidate) {
    reasons.push('no_structure_setup')
    return { setup: null, regime: regimeDetail.regime, regimeDetail, zones, reasons }
  }
  reasons.push(candidate.setupType === 'ZONE_REACTION' ? 'zone_reaction_detected' : 'breakout_pullback_retest_detected')

  // Structural setup exists from here on; confirmation quality is carried on the setup itself so
  // the state machine can distinguish SETUP (unconfirmed) from CONFIRMED without re-running.
  const confirmation = detectConfirmation(entryCandles, candidate.zone, direction, config)
  if (!confirmation.confirmed) reasons.push('confirmation_missing')
  else reasons.push('rejection_and_reclaim_confirmed')
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

  // Invalidation point: the lowest low (long) / highest high (short) since the setup started
  // interacting with the zone — where the original premise breaks down.
  const sinceTrigger = entryCandles.slice(candidate.triggerIndex)
  const stopCandidate =
    direction === 'long'
      ? Math.min(candidate.zone.low, ...sinceTrigger.map((c) => c.low))
      : Math.max(candidate.zone.high, ...sinceTrigger.map((c) => c.high))

  const triggerCandle = entryCandles[candidate.triggerIndex] ?? last
  const setup: ScalpSetup = {
    symbol,
    direction,
    regime: regimeDetail.regime,
    setupType: candidate.setupType,
    zone: candidate.zone,
    breakout: {
      direction,
      level: direction === 'long' ? candidate.zone.high : candidate.zone.low,
      breakoutIndex: candidate.triggerIndex,
      breakoutClose: triggerCandle.close,
    },
    pullback: {
      confirmed: confirmation.confirmed,
      pullbackIndex: candidate.reactionIndex,
      retestPrice: direction === 'long' ? last.low : last.high,
    },
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

  return { setup, regime: regimeDetail.regime, regimeDetail, zones, reasons }
}
