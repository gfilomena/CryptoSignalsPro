import { describe, expect, it } from 'vitest'
import { createAlertFromPreset, createCustomAlert, PRESET_DEFINITIONS } from '../presets'
import { evaluateAlert } from '../conditionEngine'
import { emptySnapshot } from './testUtils'

describe('createAlertFromPreset', () => {
  it('instantiates every preset with unique condition ids and the preset default thresholds', () => {
    for (const preset of PRESET_DEFINITIONS) {
      const alert = createAlertFromPreset(preset.id, 'Test', { symbol: 'BTC', mode: 'ALWAYS', now: 1_000_000 })
      expect(alert.conditions).toHaveLength(preset.conditions.length)
      const ids = new Set(alert.conditions.map((c) => c.id))
      expect(ids.size).toBe(alert.conditions.length)
      alert.conditions.forEach((c, i) => {
        expect(c.metric).toBe(preset.conditions[i].metric)
        expect(c.threshold).toBe(preset.conditions[i].threshold)
        expect(c.enabled).toBe(true)
      })
      expect(alert.category).toBe(preset.category)
      expect(alert.operator).toBe(preset.operator)
    }
  })

  it('two instantiations of the same preset never share condition ids (no accidental aliasing)', () => {
    const a = createAlertFromPreset('reversal_watch', 'A', { symbol: 'BTC', mode: 'ALWAYS' })
    const b = createAlertFromPreset('reversal_watch', 'B', { symbol: 'BTC', mode: 'ALWAYS' })
    expect(a.id).not.toBe(b.id)
    expect(a.conditions[0].id).not.toBe(b.conditions[0].id)
  })

  it('preset thresholds remain editable after instantiation (plain mutable data)', () => {
    const alert = createAlertFromPreset('overheated_market', 'Overheated', { symbol: 'BTC', mode: 'ALWAYS' })
    const edited = {
      ...alert,
      conditions: alert.conditions.map((c) => (c.metric === 'RSI' ? { ...c, threshold: 85 } : c)),
    }
    expect(edited.conditions.find((c) => c.metric === 'RSI')?.threshold).toBe(85)
    expect(alert.conditions.find((c) => c.metric === 'RSI')?.threshold).toBe(80) // original untouched
  })

  it('the Reversal Watch preset triggers on the example from the spec', () => {
    const alert = createAlertFromPreset('reversal_watch', 'Reversal Watch', { symbol: 'BTC', mode: 'ALWAYS' })
    const snapshot = emptySnapshot({ priceChangePct: -0.62, openInterestChangePct: { '15m': 1.43 } })
    expect(evaluateAlert(alert, snapshot).triggered).toBe(true)
  })

  it('sets expiresAt for a SESSION-mode preset and leaves it undefined for ALWAYS', () => {
    const session = createAlertFromPreset('strong_momentum', 'Momentum', { symbol: 'BTC', mode: 'SESSION', sessionDuration: '1h', now: 0 })
    expect(session.expiresAt).toBe(3_600_000)
    const always = createAlertFromPreset('strong_momentum', 'Momentum', { symbol: 'BTC', mode: 'ALWAYS' })
    expect(always.expiresAt).toBeUndefined()
  })
})

describe('createCustomAlert', () => {
  it('starts with no conditions and CUSTOM category', () => {
    const alert = createCustomAlert('My alert', { symbol: 'ETH', mode: 'ALWAYS' })
    expect(alert.conditions).toEqual([])
    expect(alert.category).toBe('CUSTOM')
    expect(alert.symbol).toBe('ETH')
  })
})
