import { describe, expect, it } from 'vitest'
import { closePaperTrade, computePaperStats, openPaperTrade } from '../paperTrading'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import type { RiskCalc, ScalpSetup, Zone } from '../../../types/scalpSignal'

const config = { ...DEFAULT_STRATEGY_CONFIG, tradingCosts: { feePct: 0.04, spreadPct: 0.02, slippagePct: 0.02 } }

const zone: Zone = { kind: 'support', low: 98, high: 99.5, touches: 2, lastTouchIndex: 3 }

const setup: ScalpSetup = {
  symbol: 'BTC',
  direction: 'long',
  regime: 'bullish',
  setupType: 'ZONE_REACTION',
  zone,
  breakout: { direction: 'long', level: 100, breakoutIndex: 5, breakoutClose: 100.5 },
  pullback: { confirmed: true, pullbackIndex: 6, retestPrice: 99.8 },
  confirmation: { confirmed: true, candlestickRejection: true, reclaimClose: true, volumeConfirmed: true, rsiConfirmed: true, macdConfirmed: true },
  entryPrice: 100,
  stopCandidate: 98,
  atr: 1,
  atrPct: 0.6,
  rsi: 55,
  macdHistogram: 1,
  volumeRatio: 1.5,
  timestamp: 0,
}

const risk: RiskCalc = {
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

describe('paper trading', () => {
  it('opens a trade with the correct cost snapshot', () => {
    const trade = openPaperTrade('t1', setup, risk, 82, config, 1000)
    expect(trade.result).toBe('OPEN')
    expect(trade.costPct).toBeCloseTo(0.04 * 2 + 0.02 + 0.02)
    expect(trade.positionSize).toBe(50)
  })

  it('closes a winning long trade near +2R after costs', () => {
    const trade = openPaperTrade('t1', setup, risk, 82, config, 1000)
    const closed = closePaperTrade(trade, 104, 'TP1', 2000)
    expect(closed.pnl).toBeGreaterThan(0)
    expect(closed.pnlR).toBeGreaterThan(1.9) // just under 2R once costs are subtracted
  })

  it('closes a losing long trade near -1R after costs', () => {
    const trade = openPaperTrade('t1', setup, risk, 82, config, 1000)
    const closed = closePaperTrade(trade, 98, 'SL', 2000)
    expect(closed.pnl).toBeLessThan(0)
    expect(closed.pnlR).toBeLessThan(-0.9)
  })

  it('computes aggregate stats over a mix of winners and losers', () => {
    const t1 = closePaperTrade(openPaperTrade('t1', setup, risk, 80, config, 1000), 104, 'TP1', 2000)
    const t2 = closePaperTrade(openPaperTrade('t2', setup, risk, 80, config, 3000), 98, 'SL', 4000)
    const t3 = closePaperTrade(openPaperTrade('t3', setup, risk, 80, config, 5000), 106, 'TP2', 6000)
    const open = openPaperTrade('t4', setup, risk, 80, config, 7000)

    const stats = computePaperStats([t1, t2, t3, open])
    expect(stats.totalTrades).toBe(3) // the still-OPEN trade is excluded
    expect(stats.wins).toBe(2)
    expect(stats.losses).toBe(1)
    expect(stats.winRate).toBeCloseTo((2 / 3) * 100)
    expect(stats.profitFactor).toBeGreaterThan(1)
  })
})
