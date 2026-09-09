import { describe, expect, it } from 'vitest'
import { calculateRisk, initialDailyRisk, todayKey, updateDailyRisk } from '../riskEngine'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import type { ScalpSetup, Zone } from '../../../types/scalpSignal'

const config = {
  ...DEFAULT_STRATEGY_CONFIG,
  capital: 10_000,
  capitalCurrency: 'usd' as const,
  riskPerTradePct: 1, // riskAmount = 100
  minRiskReward: 2,
  atrStopBufferMult: 0,
  maxStopAtr: 10,
  maxTradesPerDay: 3,
  maxDailyLossR: 2,
}

const originZone: Zone = { kind: 'support', low: 97, high: 99, touches: 2, lastTouchIndex: 3 }

function longSetup(overrides: Partial<ScalpSetup> = {}): ScalpSetup {
  return {
    symbol: 'BTC',
    direction: 'long',
    regime: 'bullish',
    setupType: 'ZONE_REACTION',
    zone: originZone,
    breakout: { direction: 'long', level: 99, breakoutIndex: 5, breakoutClose: 101 },
    pullback: { confirmed: true, pullbackIndex: 6, retestPrice: 98 },
    confirmation: { confirmed: true, candlestickRejection: true, reclaimClose: true, volumeConfirmed: true, rsiConfirmed: true, macdConfirmed: true },
    entryPrice: 100,
    stopCandidate: 98,
    atr: 1,
    atrPct: 1,
    rsi: 55,
    macdHistogram: 1,
    volumeRatio: 1.5,
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('calculateRisk — no opposing zone (plain R-multiple fallback)', () => {
  it('computes stop, position size, TP1/TP2 and R:R from the fixed risk amount', () => {
    const risk = calculateRisk(longSetup(), [], config, initialDailyRisk())
    expect(risk.valid).toBe(true)
    expect(risk.stopLoss).toBeCloseTo(98)
    expect(risk.stopDistance).toBeCloseTo(2)
    expect(risk.riskAmount).toBeCloseTo(100)
    expect(risk.positionSize).toBeCloseTo(50) // riskAmount / stopDistance
    expect(risk.riskRewardRatio).toBe(2)
    expect(risk.takeProfit1).toBeCloseTo(104) // entry + stopDistance * RR
    expect(risk.takeProfit2).toBeCloseTo(106) // entry + stopDistance * (RR + 1)
    expect(risk.rewardAmount).toBeCloseTo(200)
  })

  it('mirrors the math for a short setup', () => {
    const setup = longSetup({ direction: 'short', entryPrice: 100, stopCandidate: 102 })
    const risk = calculateRisk(setup, [], config, initialDailyRisk())
    expect(risk.valid).toBe(true)
    expect(risk.stopLoss).toBeCloseTo(102)
    expect(risk.takeProfit1).toBeCloseTo(96)
    expect(risk.takeProfit2).toBeCloseTo(94)
  })

  it('rejects the trade when the required stop is too wide relative to ATR (MAX_STOP_ATR)', () => {
    const setup = longSetup({ entryPrice: 100, stopCandidate: 50, atr: 1 })
    const risk = calculateRisk(setup, [], { ...config, maxStopAtr: 2.5 }, initialDailyRisk())
    expect(risk.valid).toBe(false)
    expect(risk.reasonInvalid).toBe('STOP_TOO_WIDE')
  })

  it('blocks new trades once the day is locked', () => {
    const risk = calculateRisk(longSetup(), [], config, { ...initialDailyRisk(), locked: true })
    expect(risk.valid).toBe(false)
    expect(risk.reasonInvalid).toBe('DAILY_LOCKED')
  })

  it('blocks new trades once MAX_TRADES_PER_DAY is reached', () => {
    const risk = calculateRisk(longSetup(), [], config, { ...initialDailyRisk(), tradesToday: config.maxTradesPerDay })
    expect(risk.valid).toBe(false)
    expect(risk.reasonInvalid).toBe('MAX_TRADES_REACHED')
  })

  it('converts the risk amount through a non-1 usdRate for position sizing', () => {
    // capital is in a currency worth 0.5 USD per unit -> risk in USD is double
    const risk = calculateRisk(longSetup(), [], config, initialDailyRisk(), 0.5)
    expect(risk.positionSize).toBeCloseTo(100) // (100 / 0.5) / 2
  })
})

describe('calculateRisk — structure-based target (next significant zone)', () => {
  it('uses the near edge of the next opposing zone as TP1 when it clears minRiskReward', () => {
    const nearResistance: Zone = { kind: 'resistance', low: 104, high: 105, touches: 2, lastTouchIndex: 10 }
    const risk = calculateRisk(longSetup(), [nearResistance], config, initialDailyRisk())
    expect(risk.valid).toBe(true)
    expect(risk.takeProfit1).toBeCloseTo(104) // nearResistance.low
    expect(risk.riskRewardRatio).toBeCloseTo(2) // (104-100)/2
    // no further zone -> TP2 falls back to a plain R multiple
    expect(risk.takeProfit2).toBeCloseTo(106)
  })

  it('uses a second, further zone as TP2 when one exists', () => {
    const nearResistance: Zone = { kind: 'resistance', low: 104, high: 105, touches: 2, lastTouchIndex: 10 }
    const furtherResistance: Zone = { kind: 'resistance', low: 110, high: 111, touches: 2, lastTouchIndex: 20 }
    const risk = calculateRisk(longSetup(), [nearResistance, furtherResistance], config, initialDailyRisk())
    expect(risk.takeProfit1).toBeCloseTo(104)
    expect(risk.takeProfit2).toBeCloseTo(110)
  })

  it('rejects the trade rather than stretching the target when the nearest zone is too close', () => {
    const tooClose: Zone = { kind: 'resistance', low: 101, high: 102, touches: 2, lastTouchIndex: 10 }
    const risk = calculateRisk(longSetup(), [tooClose], config, initialDailyRisk())
    expect(risk.valid).toBe(false)
    expect(risk.reasonInvalid).toBe('RR_TOO_LOW')
  })
})

describe('daily risk lock', () => {
  it('locks after MAX_TRADES_PER_DAY new trades', () => {
    let status = initialDailyRisk()
    for (let i = 0; i < config.maxTradesPerDay; i++) {
      status = updateDailyRisk(status, config, { newTrade: true })
    }
    expect(status.locked).toBe(true)
    expect(status.reason).toBe('max_trades')
  })

  it('locks once cumulative loss reaches MAX_DAILY_LOSS_R', () => {
    let status = initialDailyRisk()
    status = updateDailyRisk(status, config, { closedLossR: -1 })
    expect(status.locked).toBe(false)
    status = updateDailyRisk(status, config, { closedLossR: -1 })
    expect(status.locked).toBe(true)
    expect(status.reason).toBe('max_daily_loss')
  })

  it('rolls over to a fresh, unlocked status on a new day', () => {
    const yesterday = { locked: true, reason: 'max_trades', tradesToday: 3, lossRToday: 0, dayKey: '2000-01-01' }
    const status = updateDailyRisk(yesterday, config, {})
    expect(status.dayKey).toBe(todayKey())
    expect(status.locked).toBe(false)
    expect(status.tradesToday).toBe(0)
  })

  it('rolls over using a simulated timestamp when one is passed (for backtesting)', () => {
    const day1 = new Date('2020-01-01T00:00:00Z')
    const day2 = new Date('2020-01-02T00:00:00Z')
    let status = updateDailyRisk(initialDailyRisk(todayKey(day1)), config, { newTrade: true }, day1)
    expect(status.tradesToday).toBe(1)
    status = updateDailyRisk(status, config, {}, day2)
    expect(status.dayKey).toBe(todayKey(day2))
    expect(status.tradesToday).toBe(0)
  })
})
