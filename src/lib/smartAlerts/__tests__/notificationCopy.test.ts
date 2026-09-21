import { describe, expect, it } from 'vitest'
import { buildInvalidationPushPayload, buildMetricLines, buildPushPayload, directionLabel, PUSH_DISCLAIMER, toTriggeredEvent } from '../notificationCopy'
import { baseAlert, emptySnapshot } from './testUtils'

const BANNED_WORDS = ['execute trade', 'place order', 'buy btc', 'sell btc', 'compra', 'vendi', 'BUY', 'SELL']

describe('buildPushPayload', () => {
  it('never contains an automated trade-execution instruction', () => {
    const alert = baseAlert({ symbol: 'BTC', name: 'Reversal Watch', category: 'REVERSAL_WATCH' })
    const snapshot = emptySnapshot({ price: 81240, priceChangePct: -0.62, openInterestChangePct: { '15m': 1.43 }, fundingRate: 0.0081 })
    const payload = buildPushPayload(alert, snapshot, 'Reversal Watch triggered')
    const combined = `${payload.title} ${payload.body}`
    for (const banned of BANNED_WORDS) {
      expect(combined.toUpperCase()).not.toContain(banned.toUpperCase())
    }
  })

  it('includes the symbol, alert name, and key metric lines', () => {
    const alert = baseAlert({ symbol: 'BTC', name: 'Reversal Watch' })
    const snapshot = emptySnapshot({ price: 81240, priceChangePct: -0.62 })
    const payload = buildPushPayload(alert, snapshot, 'Reversal Watch triggered')
    expect(payload.title).toContain('BTC/USDT')
    expect(payload.title).toContain('Reversal Watch')
    expect(payload.body).toContain('Reversal Watch triggered')
    expect(payload.body).toContain('81,240')
  })

  it('tags the payload as a SMART_ALERT type carrying the alert id for dedup/routing', () => {
    const alert = baseAlert({ id: 'abc-123' })
    const payload = buildPushPayload(alert, emptySnapshot(), 'x')
    expect(payload.type).toBe('SMART_ALERT')
    expect(payload.alertId).toBe('abc-123')
  })
})

describe('directionLabel', () => {
  it('never implies a direction for any category (replay found no directional edge)', () => {
    for (const c of ['REVERSAL_WATCH', 'MARKET_STRENGTH', 'OVERHEATED_MARKET', 'LIQUIDATION', 'CUSTOM'] as const) {
      expect(directionLabel(c)).toBe('⚪ Condizioni rilevate')
    }
  })

  it('puts the label first in the title and a disclaimer last in the body', () => {
    const payload = buildPushPayload(baseAlert({ category: 'OVERHEATED_MARKET', name: 'Overheated Market' }), emptySnapshot({ price: 100 }), 'x')
    expect(payload.title.startsWith('⚪ Condizioni rilevate · BTC/USDT')).toBe(true)
    expect(payload.title).not.toMatch(/Bias|🟢|🔴/)
    expect(payload.body.endsWith(PUSH_DISCLAIMER)).toBe(true)
  })
})

describe('buildMetricLines', () => {
  it('omits lines for metrics that are unavailable rather than printing null/NaN', () => {
    const lines = buildMetricLines(emptySnapshot({ price: 100 }))
    expect(lines).toEqual(['Price: $100'])
  })

  it('includes every populated timeframe bucket', () => {
    const lines = buildMetricLines(emptySnapshot({ openInterestChangePct: { '15m': 1.2, '1h': -0.3 } }))
    expect(lines).toContain('OI 15m: +1.20%')
    expect(lines).toContain('OI 1h: -0.30%')
  })
})

describe('buildInvalidationPushPayload', () => {
  it('never repeats the direction bias and never contains a buy/sell word', () => {
    const alert = baseAlert({ symbol: 'BTC', name: 'Reversal Watch', category: 'REVERSAL_WATCH' })
    const payload = buildInvalidationPushPayload(alert, emptySnapshot({ price: 80000, priceChangePct: 0.1 }))
    expect(payload.title).not.toContain('Bias')
    for (const banned of BANNED_WORDS) {
      expect(`${payload.title} ${payload.body}`.toUpperCase()).not.toContain(banned.toUpperCase())
    }
    expect(payload.body).toContain(PUSH_DISCLAIMER)
  })
})

describe('toTriggeredEvent', () => {
  it('carries the matched conditions and marks the event unread', () => {
    const alert = baseAlert({ id: 'a1', name: 'Test' })
    const event = toTriggeredEvent(alert, emptySnapshot(), alert.conditions, 1_000_000)
    expect(event.alertId).toBe('a1')
    expect(event.read).toBe(false)
    expect(event.timestamp).toBe(1_000_000)
  })

  it('defaults to kind "triggered" and accepts an explicit "invalidated" kind', () => {
    const alert = baseAlert({ id: 'a1' })
    const triggered = toTriggeredEvent(alert, emptySnapshot(), [], 1_000_000)
    expect(triggered.kind).toBe('triggered')
    const invalidated = toTriggeredEvent(alert, emptySnapshot(), [], 1_000_000, 'invalidated')
    expect(invalidated.kind).toBe('invalidated')
  })

  it('generates unique ids for two events fired back to back', () => {
    const alert = baseAlert()
    const e1 = toTriggeredEvent(alert, emptySnapshot(), [], 1_000_000)
    const e2 = toTriggeredEvent(alert, emptySnapshot(), [], 1_000_001)
    expect(e1.id).not.toBe(e2.id)
  })
})
