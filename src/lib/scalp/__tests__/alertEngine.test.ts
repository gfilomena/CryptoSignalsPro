import { describe, expect, it } from 'vitest'
import { buildAlert } from '../alertEngine'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import type { ScalpSetup, Zone } from '../../../types/scalpSignal'

const config = { ...DEFAULT_STRATEGY_CONFIG, alertCooldownMs: 60_000 }

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

const now = 1_000_000

describe('buildAlert', () => {
  it('fires SETUP_DETECTED on WATCH -> LONG_SETUP', () => {
    const alert = buildAlert({
      symbol: 'BTC',
      timeframe: '5m',
      prevState: 'WATCH',
      nextState: 'LONG_SETUP',
      setup,
      risk: null,
      confidence: null,
      reasons: ['zone_reaction_detected'],
      lastAlert: null,
      now,
      config,
    })
    expect(alert?.type).toBe('SETUP_DETECTED')
  })

  it('never fires when the state did not change', () => {
    const alert = buildAlert({
      symbol: 'BTC',
      timeframe: '5m',
      prevState: 'WATCH',
      nextState: 'WATCH',
      setup: null,
      risk: null,
      confidence: null,
      reasons: [],
      lastAlert: null,
      now,
      config,
    })
    expect(alert).toBeNull()
  })

  it('deduplicates: suppresses a repeat of the same alert type within the cooldown window', () => {
    const first = buildAlert({
      symbol: 'BTC',
      timeframe: '5m',
      prevState: 'WATCH',
      nextState: 'LONG_SETUP',
      setup,
      risk: null,
      confidence: null,
      reasons: [],
      lastAlert: null,
      now,
      config,
    })
    expect(first).not.toBeNull()

    // state flaps LONG_SETUP -> WATCH -> LONG_SETUP again, well inside the cooldown window
    const second = buildAlert({
      symbol: 'BTC',
      timeframe: '5m',
      prevState: 'WATCH',
      nextState: 'LONG_SETUP',
      setup,
      risk: null,
      confidence: null,
      reasons: [],
      lastAlert: first,
      now: now + 5_000,
      config,
    })
    expect(second).toBeNull()
  })

  it('fires again once the cooldown window has elapsed', () => {
    const first = buildAlert({
      symbol: 'BTC',
      timeframe: '5m',
      prevState: 'WATCH',
      nextState: 'LONG_SETUP',
      setup,
      risk: null,
      confidence: null,
      reasons: [],
      lastAlert: null,
      now,
      config,
    })
    const later = buildAlert({
      symbol: 'BTC',
      timeframe: '5m',
      prevState: 'WATCH',
      nextState: 'LONG_SETUP',
      setup,
      risk: null,
      confidence: null,
      reasons: [],
      lastAlert: first,
      now: now + config.alertCooldownMs + 1,
      config,
    })
    expect(later).not.toBeNull()
  })

  it('maps TARGET_HIT with the TP2 hint to TP2_HIT', () => {
    const alert = buildAlert({
      symbol: 'BTC',
      timeframe: '5m',
      prevState: 'TRADE_ACTIVE',
      nextState: 'TARGET_HIT',
      setup,
      risk: null,
      confidence: null,
      reasons: [],
      targetHit: 'TP2',
      lastAlert: null,
      now,
      config,
    })
    expect(alert?.type).toBe('TP2_HIT')
  })

  it('maps an expired confirmed setup to SETUP_INVALIDATED', () => {
    const alert = buildAlert({
      symbol: 'BTC',
      timeframe: '5m',
      prevState: 'LONG_CONFIRMED',
      nextState: 'EXPIRED',
      setup: null,
      risk: null,
      confidence: null,
      reasons: [],
      lastAlert: null,
      now,
      config,
    })
    expect(alert?.type).toBe('SETUP_INVALIDATED')
  })
})
