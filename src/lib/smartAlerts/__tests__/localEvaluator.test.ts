import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseAlert, emptySnapshot } from './testUtils'
import { newCondition } from '../presets'

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

vi.mock('../marketData', () => ({
  fetchSmartAlertSnapshot: vi.fn(),
}))

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('runLocalAlertCycle', () => {
  it('fires a matching alert exactly once, fetching the symbol snapshot only once even with two alerts on it', async () => {
    const { fetchSmartAlertSnapshot } = await import('../marketData')
    const snapshot = emptySnapshot({ priceChangePct: -0.8 })
    vi.mocked(fetchSmartAlertSnapshot).mockResolvedValue(snapshot)

    const { runLocalAlertCycle } = await import('../localEvaluator')
    const alertA = baseAlert({ id: 'a1', symbol: 'BTC', conditions: [newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 })] })
    const alertB = baseAlert({ id: 'a2', symbol: 'BTC', conditions: [newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -100 })] }) // never matches

    const result = await runLocalAlertCycle([alertA, alertB], 1_000_000)
    expect(fetchSmartAlertSnapshot).toHaveBeenCalledTimes(1) // one distinct symbol, not one call per alert
    expect(result.triggeredEvents).toHaveLength(1)
    expect(result.triggeredEvents[0].alertId).toBe('a1')
  })

  it('never fires a disabled alert', async () => {
    const { fetchSmartAlertSnapshot } = await import('../marketData')
    vi.mocked(fetchSmartAlertSnapshot).mockResolvedValue(emptySnapshot({ priceChangePct: -1 }))

    const { runLocalAlertCycle } = await import('../localEvaluator')
    const alert = baseAlert({ id: 'a1', symbol: 'BTC', enabled: false, conditions: [newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 })] })
    const result = await runLocalAlertCycle([alert], 1_000_000)
    expect(result.triggeredEvents).toHaveLength(0)
  })

  it('respects cooldown across two consecutive cycles (no duplicate trigger)', async () => {
    const { fetchSmartAlertSnapshot } = await import('../marketData')
    vi.mocked(fetchSmartAlertSnapshot).mockResolvedValue(emptySnapshot({ priceChangePct: -1 }))

    const { runLocalAlertCycle } = await import('../localEvaluator')
    const { listLocalAlerts } = await import('../alertStore')
    const { saveAlert } = await import('../api')

    const alert = baseAlert({
      id: 'a1',
      symbol: 'BTC',
      cooldownMs: 60_000,
      conditions: [newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 })],
    })
    await saveAlert(alert)

    const first = await runLocalAlertCycle(listLocalAlerts(), 1_000_000)
    expect(first.triggeredEvents).toHaveLength(1)

    const second = await runLocalAlertCycle(listLocalAlerts(), 1_010_000) // 10s later, well inside cooldown
    expect(second.triggeredEvents).toHaveLength(0)

    const third = await runLocalAlertCycle(listLocalAlerts(), 1_070_000) // past the 60s cooldown
    expect(third.triggeredEvents).toHaveLength(1)
  })

  it('requires confirmationCycles consecutive matches before firing, persisting the streak between cycles', async () => {
    const { fetchSmartAlertSnapshot } = await import('../marketData')
    vi.mocked(fetchSmartAlertSnapshot).mockResolvedValue(emptySnapshot({ priceChangePct: -1 }))

    const { runLocalAlertCycle } = await import('../localEvaluator')
    const { listLocalAlerts } = await import('../alertStore')
    const { saveAlert } = await import('../api')

    const alert = baseAlert({
      id: 'a1',
      symbol: 'BTC',
      confirmationCycles: 2,
      conditions: [newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 })],
    })
    await saveAlert(alert)

    const first = await runLocalAlertCycle(listLocalAlerts(), 1_000_000)
    expect(first.triggeredEvents).toHaveLength(0) // 1st match, not yet confirmed
    expect(listLocalAlerts()[0].pendingMatchCount).toBe(1)

    const second = await runLocalAlertCycle(listLocalAlerts(), 1_000_060)
    expect(second.triggeredEvents).toHaveLength(1) // 2nd consecutive match — confirmed
    expect(second.triggeredEvents[0].kind).toBe('triggered')
  })

  it('emits an invalidated event (and resets to unconfirmed) once a fired alert stops matching', async () => {
    const { fetchSmartAlertSnapshot } = await import('../marketData')
    const { runLocalAlertCycle } = await import('../localEvaluator')
    const { listLocalAlerts } = await import('../alertStore')
    const { saveAlert } = await import('../api')

    const alert = baseAlert({
      id: 'a1',
      symbol: 'BTC',
      conditions: [newCondition({ metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 })],
    })
    await saveAlert(alert)

    vi.mocked(fetchSmartAlertSnapshot).mockResolvedValue(emptySnapshot({ priceChangePct: -1 }))
    const first = await runLocalAlertCycle(listLocalAlerts(), 1_000_000)
    expect(first.triggeredEvents[0].kind).toBe('triggered')

    vi.mocked(fetchSmartAlertSnapshot).mockResolvedValue(emptySnapshot({ priceChangePct: 1 })) // condition breaks
    const second = await runLocalAlertCycle(listLocalAlerts(), 1_000_060)
    expect(second.triggeredEvents).toHaveLength(1)
    expect(second.triggeredEvents[0].kind).toBe('invalidated')
    expect(listLocalAlerts()[0].pendingMatchCount).toBe(0)

    // Staying broken never re-emits a second invalidation event.
    const third = await runLocalAlertCycle(listLocalAlerts(), 1_000_120)
    expect(third.triggeredEvents).toHaveLength(0)
  })
})
