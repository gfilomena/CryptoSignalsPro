import type { RegimeResult } from './regime'
import type { ConfidenceBreakdown, RiskCalc, ScalpSetup } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0
  return Math.max(0, Math.min(1, x))
}

/**
 * Weighted 0-100 confidence score. Each component contributes at most its configured weight
 * (weights sum to 100 by default, see strategyConfig); every sub-score is a 0..1 quality
 * fraction so weights stay meaningful even if the user retunes them.
 */
export function calculateConfidenceScore(
  setup: ScalpSetup,
  regimeDetail: RegimeResult,
  risk: RiskCalc,
  config: StrategyConfig,
): ConfidenceBreakdown {
  const w = config.confidenceWeights

  const slopeRef = setup.atr || Math.abs(regimeDetail.ema20Slope) || 1
  const trendAlignment = w.trendAlignment * clamp01(0.5 + (Math.abs(regimeDetail.ema20Slope) / slopeRef) * 0.5)

  const breakoutStrength = setup.atr > 0 ? Math.abs(setup.breakout.breakoutClose - setup.breakout.level) / setup.atr : 0
  const breakoutQuality = w.breakoutQuality * clamp01(breakoutStrength)

  const barsToPullback = setup.pullback.pullbackIndex - setup.breakout.breakoutIndex
  const pullbackQuality = w.pullbackQuality * clamp01(1 - barsToPullback / (config.pullbackMaxBars || 1))

  const volumeRange = config.volumeConfirmMult - 1 || 1
  const volume = w.volume * clamp01((setup.volumeRatio - 1) / volumeRange)

  const rsiScore =
    setup.direction === 'long' ? clamp01((setup.rsi - 45) / 30) : clamp01((55 - setup.rsi) / 30)
  const rsi = w.rsi * rsiScore

  const macdRef = setup.entryPrice * 0.0015 || 1
  const macdAligned =
    (setup.direction === 'long' && setup.macdHistogram > 0) || (setup.direction === 'short' && setup.macdHistogram < 0)
  const macd = w.macd * (macdAligned ? clamp01(Math.abs(setup.macdHistogram) / macdRef) : 0)

  // Moderate volatility (a healthy, tradable ATR%) scores higher than near-zero or extreme moves.
  const volatility = w.volatility * clamp01(1 - Math.abs(setup.atrPct - 0.6) / 1.2)

  const riskReward = risk.valid ? w.riskReward * clamp01(risk.riskRewardRatio / (config.minRiskReward * 1.5)) : 0

  const total = Math.round(
    Math.min(100, trendAlignment + breakoutQuality + pullbackQuality + volume + rsi + macd + volatility + riskReward),
  )

  return { trendAlignment, breakoutQuality, pullbackQuality, volume, rsi, macd, volatility, riskReward, total }
}
