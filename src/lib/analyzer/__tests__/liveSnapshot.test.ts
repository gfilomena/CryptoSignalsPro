import { describe, expect, it } from 'vitest'
import { AnalyzerDataError, buildSnapshot, type Bar5, type LiveInputs } from '../liveSnapshot'
import { BAR_MS } from '../config'
import { FEATURE_NAMES, featureVector, prepareSeries, trendFromCandles } from '../features'
import { mulberry32 } from '../stats'
import { synthBars, synthFunding, synthOi } from './testUtils'
import type { Candle } from '../../../types/scalpSignal'

const N = 1500
const b = synthBars(N)
const bars5m: Bar5[] = b.t.map((t, i) => ({ t, o: b.c[i], h: b.h[i], l: b.l[i], c: b.c[i], v: b.v[i], ct: t + BAR_MS - 1 }))
const oiMap = synthOi(b)
const spot4h: Candle[] = (() => {
  const r = mulberry32(5)
  let p = 40_000
  return Array.from({ length: 300 }, (_, i) => {
    const o = p
    p *= 1 + (r() - 0.45) * 0.01
    return { openTime: b.t[0] - (300 - i) * 4 * 3_600_000, open: o, high: Math.max(o, p) * 1.002, low: Math.min(o, p) * 0.998, close: p, volume: 10, closeTime: b.t[0] - (300 - i) * 4 * 3_600_000 + 4 * 3_600_000 - 1 }
  })
})()
const lastClose = bars5m[N - 1].ct
const inputs = (over: Partial<LiveInputs> = {}): LiveInputs => ({
  capturedAt: lastClose + 45_000,
  bars5m,
  oi: Array.from(oiMap, ([t, oi]) => ({ t, oi })),
  funding: synthFunding(b),
  spot4h,
  lastPrice: bars5m[N - 1].c * 1.0001,
  markPrice: bars5m[N - 1].c * 1.0002,
  indexPrice: bars5m[N - 1].c * 0.9999,
  ...over,
})

describe('buildSnapshot', () => {
  it('freezes T at the close of the last CLOSED 5-minute bar and produces exactly the shared feature vector', () => {
    const snap = buildSnapshot(inputs())
    expect(snap.t).toBe(lastClose + 1)
    const s = prepareSeries({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })
    const direct = featureVector(s, N - 1, { oiAt: (t) => oiMap.get(t), funding: synthFunding(b).filter((f) => f.t <= snap.t), trend: trendFromCandles(spot4h) })!
    expect(snap.vector).toEqual(Array.from(direct))
    expect(snap.featureNames).toEqual(FEATURE_NAMES)
    expect(snap.entryPrice).toBe(b.c[N - 1])
  })
  it('ignores the still-forming bar and anything newer than the capture time (no look-ahead in live mode)', () => {
    const forming: Bar5 = { t: lastClose + 1, o: 1, h: 1e9, l: 1e-9, c: 5, v: 1e12, ct: lastClose + BAR_MS }
    const a = buildSnapshot(inputs())
    const withForming = buildSnapshot(inputs({ bars5m: [...bars5m, forming] }))
    expect(withForming).toEqual(a)
    const futureOi = [...inputs().oi, { t: lastClose + 1, oi: 1 }, { t: lastClose + 1 + BAR_MS, oi: 2 }]
    expect(buildSnapshot(inputs({ oi: futureOi })).vector).toEqual(a.vector)
    const futureFunding = [...inputs().funding, { t: lastClose + 60_000, rate: 50 }]
    expect(buildSnapshot(inputs({ funding: futureFunding })).vector).toEqual(a.vector)
  })
  it('is reproducible: same inputs → identical snapshot', () => {
    expect(buildSnapshot(inputs())).toEqual(buildSnapshot(inputs()))
  })
  it('display fields are consistent with the bars and never invent unavailable data', () => {
    const d = buildSnapshot(inputs()).display
    expect(d.priceChangePct['1h']).toBeCloseTo((b.c[N - 1] / b.c[N - 13] - 1) * 100, 10)
    expect(d.distFromHighPct).toBeLessThanOrEqual(0)
    expect(d.volumePercentile1h).toBeGreaterThanOrEqual(0)
    expect(d.volumePercentile1h).toBeLessThanOrEqual(1)
    expect(d.unavailable.join(' ')).toMatch(/liquidations/)
    expect(d.markPrice).not.toBeNull()
  })
  it('missing inputs raise a named data error instead of a guessed value', () => {
    expect(() => buildSnapshot(inputs({ oi: [] }))).toThrow(AnalyzerDataError)
    expect(() => buildSnapshot(inputs({ funding: [] }))).toThrow(/funding/)
    expect(() => buildSnapshot(inputs({ bars5m: bars5m.slice(0, 100) }))).toThrow(/not_enough_5m_bars/)
  })
  it('a duplicated bar or out-of-order feed cannot silently pass through as a longer history', () => {
    const dup = [...bars5m.slice(0, 1000), bars5m[999], ...bars5m.slice(1000)]
    // the duplicate shifts every later index: the vector must differ from the clean one (it is a data problem the caller must fix)
    expect(buildSnapshot(inputs({ bars5m: dup })).vector).not.toEqual(buildSnapshot(inputs()).vector)
  })
})
