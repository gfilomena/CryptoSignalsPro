import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addLocalHistoryEvent,
  deleteLocalAlert,
  deleteLocalHistoryEvent,
  expireLocalSessions,
  listLocalAlerts,
  listLocalHistory,
  markLocalHistoryRead,
  recordLocalTrigger,
  setLocalAlertEnabled,
  upsertLocalAlert,
} from '../alertStore'
import { baseAlert, emptySnapshot } from './testUtils'
import { toTriggeredEvent } from '../notificationCopy'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('alert CRUD', () => {
  it('creates and lists an alert', () => {
    const alert = baseAlert({ id: 'a1', name: 'Reversal Watch' })
    upsertLocalAlert(alert)
    expect(listLocalAlerts()).toHaveLength(1)
    expect(listLocalAlerts()[0].name).toBe('Reversal Watch')
  })

  it('edits an alert in place (same id, no duplicate row)', () => {
    upsertLocalAlert(baseAlert({ id: 'a1', name: 'Original' }))
    upsertLocalAlert(baseAlert({ id: 'a1', name: 'Renamed' }))
    const all = listLocalAlerts()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('Renamed')
  })

  it('enables and disables an alert', () => {
    upsertLocalAlert(baseAlert({ id: 'a1', enabled: true }))
    setLocalAlertEnabled('a1', false)
    expect(listLocalAlerts()[0].enabled).toBe(false)
    setLocalAlertEnabled('a1', true)
    expect(listLocalAlerts()[0].enabled).toBe(true)
  })

  it('deletes an alert', () => {
    upsertLocalAlert(baseAlert({ id: 'a1' }))
    upsertLocalAlert(baseAlert({ id: 'a2' }))
    deleteLocalAlert('a1')
    const all = listLocalAlerts()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('a2')
  })

  it('re-enabling a session-expired alert clears the sessionExpired flag', () => {
    upsertLocalAlert(baseAlert({ id: 'a1', enabled: false, sessionExpired: true }))
    setLocalAlertEnabled('a1', true)
    expect(listLocalAlerts()[0].sessionExpired).toBe(false)
  })
})

describe('expireLocalSessions', () => {
  it('auto-pauses a SESSION alert once now passes expiresAt', () => {
    upsertLocalAlert(baseAlert({ id: 'a1', mode: 'SESSION', expiresAt: 1_000_000, enabled: true }))
    const after = expireLocalSessions(1_000_001)
    expect(after[0].enabled).toBe(false)
    expect(after[0].sessionExpired).toBe(true)
  })

  it('leaves an ALWAYS alert untouched regardless of the clock', () => {
    upsertLocalAlert(baseAlert({ id: 'a1', mode: 'ALWAYS', enabled: true }))
    const after = expireLocalSessions(Number.MAX_SAFE_INTEGER)
    expect(after[0].enabled).toBe(true)
  })

  it('does not touch a SESSION alert still inside its window', () => {
    upsertLocalAlert(baseAlert({ id: 'a1', mode: 'SESSION', expiresAt: 1_000_000, enabled: true }))
    const after = expireLocalSessions(500_000)
    expect(after[0].enabled).toBe(true)
  })
})

describe('recordLocalTrigger (cooldown bookkeeping)', () => {
  it('sets lastTriggeredAt on the matching alert only', () => {
    upsertLocalAlert(baseAlert({ id: 'a1' }))
    upsertLocalAlert(baseAlert({ id: 'a2' }))
    recordLocalTrigger('a1', 555)
    const all = listLocalAlerts()
    expect(all.find((a) => a.id === 'a1')?.lastTriggeredAt).toBe(555)
    expect(all.find((a) => a.id === 'a2')?.lastTriggeredAt).toBeUndefined()
  })
})

describe('history / duplicate prevention', () => {
  it('appends a triggered event to history', () => {
    const alert = baseAlert({ id: 'a1', name: 'Reversal Watch' })
    const event = toTriggeredEvent(alert, emptySnapshot(), [], 1_000)
    addLocalHistoryEvent(event)
    expect(listLocalHistory()).toHaveLength(1)
  })

  it('never inserts two history rows with the same event id (duplicate prevention)', () => {
    const alert = baseAlert({ id: 'a1' })
    const event = toTriggeredEvent(alert, emptySnapshot(), [], 1_000)
    addLocalHistoryEvent(event)
    addLocalHistoryEvent(event) // same id, simulating a duplicate delivery
    expect(listLocalHistory()).toHaveLength(1)
  })

  it('marks a history event as read', () => {
    const alert = baseAlert({ id: 'a1' })
    const event = toTriggeredEvent(alert, emptySnapshot(), [], 1_000)
    addLocalHistoryEvent(event)
    markLocalHistoryRead(event.id)
    expect(listLocalHistory()[0].read).toBe(true)
  })

  it('deletes a history event', () => {
    const alert = baseAlert({ id: 'a1' })
    const event = toTriggeredEvent(alert, emptySnapshot(), [], 1_000)
    addLocalHistoryEvent(event)
    deleteLocalHistoryEvent(event.id)
    expect(listLocalHistory()).toHaveLength(0)
  })
})
