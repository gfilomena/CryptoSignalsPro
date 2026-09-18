import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listAlerts, listHistory, removeAlert, saveAlert, setAlertEnabled } from '../api'
import { baseAlert, emptySnapshot } from './testUtils'
import { toTriggeredEvent } from '../notificationCopy'
import { recordHistoryEvent } from '../api'

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

// hasSupabaseConfig is false in this test environment (no VITE_SUPABASE_URL set), so every call
// below exercises the local-only fallback path — this is also exactly what a fresh/offline
// install of the app does.

describe('api.ts local fallback (Supabase not configured)', () => {
  it('saveAlert + listAlerts round-trips through the local store', async () => {
    const alert = baseAlert({ id: 'a1', name: 'Reversal Watch' })
    await saveAlert(alert)
    const all = await listAlerts()
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('Reversal Watch')
  })

  it('setAlertEnabled toggles without requiring a network call', async () => {
    await saveAlert(baseAlert({ id: 'a1', enabled: true }))
    await setAlertEnabled('a1', false)
    const all = await listAlerts()
    expect(all[0].enabled).toBe(false)
  })

  it('removeAlert deletes locally', async () => {
    await saveAlert(baseAlert({ id: 'a1' }))
    await removeAlert('a1')
    expect(await listAlerts()).toHaveLength(0)
  })

  it('listHistory falls back to the local cache', async () => {
    const alert = baseAlert({ id: 'a1' })
    const event = toTriggeredEvent(alert, emptySnapshot(), [], 1_000)
    await recordHistoryEvent(event)
    const history = await listHistory()
    expect(history).toHaveLength(1)
    expect(history[0].alertId).toBe('a1')
  })
})
