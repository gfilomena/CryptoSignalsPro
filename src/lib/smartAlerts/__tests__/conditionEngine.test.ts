import { describe, expect, it } from 'vitest'
import {
  computeExpiresAt,
  evaluateAlert,
  evaluateCondition,
  isInCooldown,
  isSessionExpired,
  processAlert,
} from '../conditionEngine'
import { newCondition } from '../presets'
import { baseAlert, emptySnapshot } from './testUtils'

describe('evaluateCondition', () => {
  it('matches a simple threshold comparison', () => {
    const c = newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 })
    expect(evaluateCondition(c, emptySnapshot({ priceChangePct: -0.6 }))).toBe(true)
    expect(evaluateCondition(c, emptySnapshot({ priceChangePct: -0.2 }))).toBe(false)
  })

  it('reads timeframe-scoped metrics from the correct bucket', () => {
    const c = newCondition({ metric: 'OPEN_INTEREST_CHANGE', timeframe: '15m', operator: '>=', threshold: 1 })
    const snapshot = emptySnapshot({ openInterestChangePct: { '15m': 1.5, '1h': -5 } })
    expect(evaluateCondition(c, snapshot)).toBe(true)
  })

  it('returns null (unavailable) when the metric is missing from the snapshot', () => {
    const c = newCondition({ metric: 'RSI', timeframe: '1h', operator: '>=', threshold: 80 })
    expect(evaluateCondition(c, emptySnapshot())).toBeNull()
  })

  it('returns null when a timeframe-scoped condition has no timeframe set (invalid config)', () => {
    const c = newCondition({ metric: 'RSI', operator: '>=', threshold: 80 })
    expect(evaluateCondition(c, emptySnapshot({ rsi: { '1h': 85 } }))).toBeNull()
  })

  it('returns null for a non-finite threshold (invalid input)', () => {
    const c = newCondition({ metric: 'PRICE', operator: '>=', threshold: NaN })
    expect(evaluateCondition(c, emptySnapshot({ price: 100 }))).toBeNull()
  })

  it('treats LIQUIDATION_SPIKE as a 1/0 boolean metric', () => {
    const c = newCondition({ metric: 'LIQUIDATION_SPIKE', operator: '==', threshold: 1 })
    expect(evaluateCondition(c, emptySnapshot({ liquidationSpike: true }))).toBe(true)
    expect(evaluateCondition(c, emptySnapshot({ liquidationSpike: false }))).toBe(false)
    expect(evaluateCondition(c, emptySnapshot({ liquidationSpike: null }))).toBeNull()
  })
})

describe('evaluateAlert — AND', () => {
  const alert = baseAlert({
    operator: 'AND',
    conditions: [
      newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 }),
      newCondition({ metric: 'OPEN_INTEREST_CHANGE', timeframe: '15m', operator: '>=', threshold: 1 }),
    ],
  })

  it('triggers only when every enabled condition matches', () => {
    const snapshot = emptySnapshot({ priceChangePct: -0.6, openInterestChangePct: { '15m': 1.2 } })
    const result = evaluateAlert(alert, snapshot)
    expect(result.triggered).toBe(true)
    expect(result.matchedConditions).toHaveLength(2)
  })

  it('does not trigger when only one condition matches', () => {
    const snapshot = emptySnapshot({ priceChangePct: -0.6, openInterestChangePct: { '15m': -1 } })
    expect(evaluateAlert(alert, snapshot).triggered).toBe(false)
  })

  it('fails closed when a condition is unavailable, even if the rest match', () => {
    const snapshot = emptySnapshot({ priceChangePct: -0.6 }) // OI change missing
    const result = evaluateAlert(alert, snapshot)
    expect(result.triggered).toBe(false)
    expect(result.unavailableConditions).toHaveLength(1)
  })

  it('ignores disabled conditions entirely', () => {
    const withDisabled = baseAlert({
      operator: 'AND',
      conditions: [
        newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 }),
        newCondition({ metric: 'RSI', timeframe: '1h', operator: '>=', threshold: 999, enabled: false }),
      ],
    })
    const snapshot = emptySnapshot({ priceChangePct: -0.6 })
    expect(evaluateAlert(withDisabled, snapshot).triggered).toBe(true)
  })

  it('never triggers with zero enabled conditions', () => {
    expect(evaluateAlert(baseAlert({ conditions: [] }), emptySnapshot()).triggered).toBe(false)
  })
})

describe('evaluateAlert — OR', () => {
  const alert = baseAlert({
    operator: 'OR',
    conditions: [
      newCondition({ metric: 'RSI', timeframe: '1h', operator: '>=', threshold: 80 }),
      newCondition({ metric: 'FUNDING_RATE', operator: '>=', threshold: 0.05 }),
    ],
  })

  it('triggers when at least one condition matches', () => {
    const snapshot = emptySnapshot({ rsi: { '1h': 85 }, fundingRate: 0.001 })
    expect(evaluateAlert(alert, snapshot).triggered).toBe(true)
  })

  it('skips unavailable conditions rather than blocking the others', () => {
    const snapshot = emptySnapshot({ fundingRate: 0.06 }) // RSI missing entirely
    const result = evaluateAlert(alert, snapshot)
    expect(result.triggered).toBe(true)
    expect(result.unavailableConditions).toHaveLength(1)
  })

  it('does not trigger when nothing matches', () => {
    const snapshot = emptySnapshot({ rsi: { '1h': 40 }, fundingRate: 0.001 })
    expect(evaluateAlert(alert, snapshot).triggered).toBe(false)
  })
})

describe('cooldown / session expiry', () => {
  it('isInCooldown is false when never triggered', () => {
    expect(isInCooldown(baseAlert(), 1_000_000)).toBe(false)
  })

  it('isInCooldown is true within the window and false after it elapses', () => {
    const alert = baseAlert({ cooldownMs: 60_000, lastTriggeredAt: 1_000_000 })
    expect(isInCooldown(alert, 1_030_000)).toBe(true)
    expect(isInCooldown(alert, 1_060_001)).toBe(false)
  })

  it('computeExpiresAt returns undefined for ALWAYS mode', () => {
    expect(computeExpiresAt('ALWAYS', undefined, 1_000_000)).toBeUndefined()
  })

  it('computeExpiresAt adds the session duration for a fixed window', () => {
    expect(computeExpiresAt('SESSION', '1h', 1_000_000)).toBe(1_000_000 + 3_600_000)
  })

  it('isSessionExpired flips true once now passes expiresAt', () => {
    const alert = baseAlert({ mode: 'SESSION', expiresAt: 1_000_000 })
    expect(isSessionExpired(alert, 999_999)).toBe(false)
    expect(isSessionExpired(alert, 1_000_000)).toBe(true)
  })

  it('an ALWAYS alert is never treated as session-expired', () => {
    expect(isSessionExpired(baseAlert({ mode: 'ALWAYS' }), Number.MAX_SAFE_INTEGER)).toBe(false)
  })
})

describe('processAlert — the single gate for firing', () => {
  const matchingSnapshot = emptySnapshot({ priceChangePct: -1 })
  const alert = baseAlert({
    operator: 'AND',
    conditions: [newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 })],
  })

  it('fires when enabled, matched, not expired, not in cooldown', () => {
    const result = processAlert(alert, matchingSnapshot, 1_000_000)
    expect(result.shouldFire).toBe(true)
  })

  it('never fires when disabled, even if conditions match', () => {
    const result = processAlert({ ...alert, enabled: false }, matchingSnapshot, 1_000_000)
    expect(result.shouldFire).toBe(false)
  })

  it('never fires a session alert past its expiry, regardless of matching conditions', () => {
    const expired = { ...alert, mode: 'SESSION' as const, expiresAt: 500_000 }
    const result = processAlert(expired, matchingSnapshot, 1_000_000)
    expect(result.expired).toBe(true)
    expect(result.shouldFire).toBe(false)
  })

  it('suppresses a repeat fire inside the cooldown window (duplicate protection)', () => {
    const recent = { ...alert, lastTriggeredAt: 999_000, cooldownMs: 60_000 }
    const result = processAlert(recent, matchingSnapshot, 1_000_000)
    expect(result.inCooldown).toBe(true)
    expect(result.shouldFire).toBe(false)
  })

  it('fires again once the cooldown window has fully elapsed', () => {
    const later = { ...alert, lastTriggeredAt: 900_000, cooldownMs: 60_000 }
    const result = processAlert(later, matchingSnapshot, 1_000_000)
    expect(result.shouldFire).toBe(true)
  })

  it('never fires when the underlying market data is missing', () => {
    const result = processAlert(alert, emptySnapshot(), 1_000_000)
    expect(result.evaluation.unavailableConditions).toHaveLength(1)
    expect(result.shouldFire).toBe(false)
  })
})

describe('processAlert — confirmation cycles (multi-tick hysteresis)', () => {
  const matchingSnapshot = emptySnapshot({ priceChangePct: -1 })
  const notMatchingSnapshot = emptySnapshot({ priceChangePct: 1 })
  const alert = baseAlert({
    confirmationCycles: 3,
    operator: 'AND',
    conditions: [newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 })],
  })

  it('does not fire on the first match when more than 1 cycle is required', () => {
    const result = processAlert(alert, matchingSnapshot, 1_000_000)
    expect(result.nextPendingMatchCount).toBe(1)
    expect(result.shouldFire).toBe(false)
  })

  it('fires only once the match streak reaches the required cycle count', () => {
    let a = alert
    let result = processAlert(a, matchingSnapshot, 1_000_000)
    a = { ...a, pendingMatchCount: result.nextPendingMatchCount }
    expect(result.shouldFire).toBe(false)

    result = processAlert(a, matchingSnapshot, 1_000_060)
    a = { ...a, pendingMatchCount: result.nextPendingMatchCount }
    expect(result.nextPendingMatchCount).toBe(2)
    expect(result.shouldFire).toBe(false)

    result = processAlert(a, matchingSnapshot, 1_000_120)
    expect(result.nextPendingMatchCount).toBe(3)
    expect(result.shouldFire).toBe(true)
  })

  it('resets the streak to 0 the moment a cycle does not match', () => {
    const midStreak = { ...alert, pendingMatchCount: 2 }
    const result = processAlert(midStreak, notMatchingSnapshot, 1_000_000)
    expect(result.nextPendingMatchCount).toBe(0)
    expect(result.shouldFire).toBe(false)
  })

  it('confirmationCycles of 1 fires on the very first match (original single-shot behavior)', () => {
    const singleShot = { ...alert, confirmationCycles: 1 }
    const result = processAlert(singleShot, matchingSnapshot, 1_000_000)
    expect(result.shouldFire).toBe(true)
  })
})

describe('processAlert — invalidation', () => {
  const matchingSnapshot = emptySnapshot({ priceChangePct: -1 })
  const notMatchingSnapshot = emptySnapshot({ priceChangePct: 1 })
  const firedAlert = baseAlert({
    lastTriggeredAt: 900_000,
    pendingMatchCount: 3,
    operator: 'AND',
    conditions: [newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 })],
  })

  it('flags shouldInvalidate once when a previously-fired alert stops matching', () => {
    const result = processAlert(firedAlert, notMatchingSnapshot, 1_000_000)
    expect(result.shouldInvalidate).toBe(true)
    expect(result.nextPendingMatchCount).toBe(0)
  })

  it('never invalidates an alert that never fired (lastTriggeredAt unset)', () => {
    const neverFired = { ...firedAlert, lastTriggeredAt: undefined }
    const result = processAlert(neverFired, notMatchingSnapshot, 1_000_000)
    expect(result.shouldInvalidate).toBe(false)
  })

  it('never invalidates while conditions are still matching', () => {
    const result = processAlert(firedAlert, matchingSnapshot, 1_000_000)
    expect(result.shouldInvalidate).toBe(false)
  })

  it('only fires the invalidation once — the next cycle pendingMatchCount is already 0', () => {
    const first = processAlert(firedAlert, notMatchingSnapshot, 1_000_000)
    expect(first.shouldInvalidate).toBe(true)
    const afterBreak = { ...firedAlert, pendingMatchCount: first.nextPendingMatchCount }
    const second = processAlert(afterBreak, notMatchingSnapshot, 1_000_060)
    expect(second.shouldInvalidate).toBe(false)
  })

  it('respects its own cooldown (lastInvalidatedAt), independent of the trigger cooldown', () => {
    const recentlyInvalidated = { ...firedAlert, lastInvalidatedAt: 999_000, cooldownMs: 60_000 }
    const result = processAlert(recentlyInvalidated, notMatchingSnapshot, 1_000_000)
    expect(result.shouldInvalidate).toBe(false)
  })

  it('never invalidates a disabled or session-expired alert', () => {
    const disabled = { ...firedAlert, enabled: false }
    expect(processAlert(disabled, notMatchingSnapshot, 1_000_000).shouldInvalidate).toBe(false)
    const expired = { ...firedAlert, mode: 'SESSION' as const, expiresAt: 500_000 }
    expect(processAlert(expired, notMatchingSnapshot, 1_000_000).shouldInvalidate).toBe(false)
  })
})
