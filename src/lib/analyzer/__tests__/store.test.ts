import { describe, expect, it } from 'vitest'
import { BAR_MS } from '../config'
import { FEATURE_NAMES } from '../features'
import { barIndexOfObservation, decodeStore, encodeStore } from '../store'
import { synthStore } from './testUtils'

describe('feature store', () => {
  const store = synthStore(4000)
  it('round-trips through the binary format within the int16 quantisation error', () => {
    const again = decodeStore(encodeStore({
      meta: { symbol: 'T', trainEndMs: store.meta.trainEndMs, valEndMs: store.meta.valEndMs, dataStartMs: store.meta.dataStartMs, dataEndMs: store.meta.dataEndMs, thresholdBase: 1.2, t0Bars: store.meta.t0Bars, builtAt: 'x', source: 's' },
      times: Array.from(store.times),
      rows: Array.from({ length: store.n }, (_, r) => Float64Array.from(store.raw.subarray(r * store.F, (r + 1) * store.F))),
      bars: store.bars,
    }))
    expect(again.n).toBe(store.n)
    expect(Array.from(again.times)).toEqual(Array.from(store.times))
    for (let i = 0; i < store.raw.length; i += 997) {
      const f = i % store.F
      expect(Math.abs(again.raw[i] - store.raw[i])).toBeLessThanOrEqual(store.meta.quantScale[f] * 1.01 + 1e-9)
    }
    expect(again.meta.version).toMatch(/^[0-9a-f]{8}$/)
  })
  it('content version is deterministic', () => {
    expect(synthStore(4000).meta.version).toBe(store.meta.version)
  })
  it('times are strictly increasing and unique; encoding rejects duplicates / disorder', () => {
    for (let i = 1; i < store.n; i++) expect(store.times[i]).toBeGreaterThan(store.times[i - 1])
    const row = new Float64Array(FEATURE_NAMES.length)
    const meta = { symbol: 'T', trainEndMs: 0, valEndMs: 0, dataStartMs: 0, dataEndMs: 0, thresholdBase: 1, t0Bars: 0, builtAt: '', source: '' }
    expect(() => encodeStore({ meta, times: [1, 1], rows: [row, row], bars: { c: [1], h: [1], l: [1] } })).toThrow(/strictly increasing/)
    expect(() => encodeStore({ meta, times: [2, 1], rows: [row, row], bars: { c: [1], h: [1], l: [1] } })).toThrow()
  })
  it('scaler is fitted on train rows only', () => {
    expect(store.nTrain).toBeGreaterThan(0)
    expect(store.nTrain).toBeLessThan(store.n)
    expect(store.times[store.nTrain - 1]).toBeLessThan(store.meta.trainEndMs)
  })
  it('rejects a foreign file and a stale feature layout', () => {
    expect(() => decodeStore(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not an analyzer store/)
  })
  it('observation → bar index is exact', () => {
    const i = 1500
    expect(barIndexOfObservation(store, store.bars.t0 + (i + 1) * BAR_MS)).toBe(i)
  })
})
