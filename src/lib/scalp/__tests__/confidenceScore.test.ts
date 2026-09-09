import { describe, expect, it } from 'vitest'
import { calculateConfidenceScore } from '../confidenceScore'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import type { RegimeResult } from '../regime'
import type { RiskCalc, ScalpSetup } from '../../../types/scalpSignal'

const config = DEFAULT_STRATEGY_CONFIG

function setup(overrides: Partial<ScalpSetup> = {}): ScalpSetup {
  return {
    symbol: 'BTC',
    direction: 'long',
    regime: 'bullish',
    breakout: { direction: 'long', level: 100, breakoutIndex: 5, breakoutClose: 100.5 },
    pullback: { confirmed: true, pullbackIndex: 6, retestPrice: 99.8 },
    confirmation: { confirmed: true, candlestickRejection: true, volumeConfirmed: true, rsiConfirmed: true, macdConfirmed: true },
    entryPrice: 100,
    stopCandidate: 98,
    atr: 1,
    atrPct: 0.6,
    rsi: 55,
    macdHistogram: 1,
    volumeRatio: 1.5,
    timestamp: Date.now(),
    ...overrides,
  }
}

const regime: RegimeResult = { regime: 'bullish', price: 100, ema20: 100, ema50: 99, ema200: 95, ema20Slope: 1, ema50Slope: 0.5 }

const validRisk: RiskCalc = {
  valid: true,
  stopLoss: 98,
  stopDistance: 2,
  riskAmount: 100,
  rewardAmount: 200,
  positionSize: 50,
  takeProfit1: 104,
  takeProfit2: 106,
  riskRewardRatio: 2,
  capitalCurrency: 'usd',
}

const invalidRisk: RiskCalc = { ...validRisk, valid: false, reasonInvalid: 'STOP_TOO_WIDE' }

describe('calculateConfidenceScore', () => {
  it('stays within 0..100 and is deterministic', () => {
    const a = calculateConfidenceScore(setup(), regime, validRisk, config)
    const b = calculateConfidenceScore(setup(), regime, validRisk, config)
    expect(a.total).toBe(b.total)
    expect(a.total).toBeGreaterThanOrEqual(0)
    expect(a.total).toBeLessThanOrEqual(100)
  })

  it('scores a strong setup higher than a weak one', () => {
    const strong = calculateConfidenceScore(
      setup({ volumeRatio: 3, rsi: 60, macdHistogram: 5, atrPct: 0.6 }),
      { ...regime, ema20Slope: 5 },
      validRisk,
      config,
    )
    const weak = calculateConfidenceScore(
      setup({ volumeRatio: 1, rsi: 46, macdHistogram: 0.001, atrPct: 3 }),
      { ...regime, ema20Slope: 0 },
      invalidRisk,
      config,
    )
    expect(strong.total).toBeGreaterThan(weak.total)
  })

  it('gives zero riskReward contribution when the risk calc is invalid', () => {
    const result = calculateConfidenceScore(setup(), regime, invalidRisk, config)
    expect(result.riskReward).toBe(0)
  })
})
