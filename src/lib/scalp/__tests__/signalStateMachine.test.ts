import { describe, expect, it } from 'vitest'
import { nextSignalState } from '../signalStateMachine'
import type { RiskCalc, ScalpSetup } from '../../../types/scalpSignal'

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

describe('nextSignalState', () => {
  it('stays NO_TRADE when there is no setup and the regime is neutral', () => {
    const state = nextSignalState({
      prevState: 'NO_TRADE',
      regime: 'neutral',
      setup: null,
      risk: null,
      confidenceTotal: 0,
      minConfidence: 70,
      activeTrade: null,
      currentPrice: 100,
    })
    expect(state).toBe('NO_TRADE')
  })

  it('moves to WATCH when the regime is aligned but there is no setup yet', () => {
    const state = nextSignalState({
      prevState: 'NO_TRADE',
      regime: 'bullish',
      setup: null,
      risk: null,
      confidenceTotal: 0,
      minConfidence: 70,
      activeTrade: null,
      currentPrice: 100,
    })
    expect(state).toBe('WATCH')
  })

  it('is LONG_SETUP (not CONFIRMED) when confidence is below the threshold', () => {
    const state = nextSignalState({
      prevState: 'WATCH',
      regime: 'bullish',
      setup: setup(),
      risk: validRisk,
      confidenceTotal: 40,
      minConfidence: 70,
      activeTrade: null,
      currentPrice: 100,
    })
    expect(state).toBe('LONG_SETUP')
  })

  it('is LONG_CONFIRMED once confirmed + risk-valid + confidence clears the threshold', () => {
    const state = nextSignalState({
      prevState: 'LONG_SETUP',
      regime: 'bullish',
      setup: setup(),
      risk: validRisk,
      confidenceTotal: 82,
      minConfidence: 70,
      activeTrade: null,
      currentPrice: 100,
    })
    expect(state).toBe('LONG_CONFIRMED')
  })

  it('expires an active setup that disappears (setup invalidated)', () => {
    const state = nextSignalState({
      prevState: 'LONG_CONFIRMED',
      regime: 'bullish',
      setup: null,
      risk: null,
      confidenceTotal: 0,
      minConfidence: 70,
      activeTrade: null,
      currentPrice: 100,
    })
    expect(state).toBe('EXPIRED')
  })

  it('detects a stop hit while a trade is active', () => {
    const state = nextSignalState({
      prevState: 'TRADE_ACTIVE',
      regime: 'bullish',
      setup: null,
      risk: null,
      confidenceTotal: 0,
      minConfidence: 70,
      activeTrade: { direction: 'long', stopLoss: 98, takeProfit1: 104, takeProfit2: 106 },
      currentPrice: 97,
    })
    expect(state).toBe('STOP_HIT')
  })

  it('detects a target hit while a trade is active', () => {
    const state = nextSignalState({
      prevState: 'TRADE_ACTIVE',
      regime: 'bullish',
      setup: null,
      risk: null,
      confidenceTotal: 0,
      minConfidence: 70,
      activeTrade: { direction: 'long', stopLoss: 98, takeProfit1: 104, takeProfit2: 106 },
      currentPrice: 105,
    })
    expect(state).toBe('TARGET_HIT')
  })

  it('stays TRADE_ACTIVE while price is between stop and target', () => {
    const state = nextSignalState({
      prevState: 'TRADE_ACTIVE',
      regime: 'bullish',
      setup: null,
      risk: null,
      confidenceTotal: 0,
      minConfidence: 70,
      activeTrade: { direction: 'long', stopLoss: 98, takeProfit1: 104, takeProfit2: 106 },
      currentPrice: 101,
    })
    expect(state).toBe('TRADE_ACTIVE')
  })
})
