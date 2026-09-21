import { describe, expect, it } from 'vitest'
import { BAR_MS, BASELINE_BARS, MIN_BAR_INDEX, OI_LAG_MS } from '../config'
import { FEATURES, FEATURE_NAMES, featureIndex, featureVector, fundingIndexAt, fundingPercentile, observationTime, oiBoundary, prepareSeries, type FundingPoint } from '../features'
import { synthBars, synthFunding, synthOi } from './testUtils'

const n = 1500
const bars = synthBars(n)
const series = () => prepareSeries({ t: bars.t, h: bars.h, l: bars.l, c: bars.c, v: bars.v })
const oi = synthOi(bars)
const funding = synthFunding(bars)
const ctx = { oiAt: (t: number) => oi.get(t), funding, trend: 1 as const }
const I = 1200

describe('feature vector', () => {
  it('has the documented layout: 22 features in 7 groups', () => {
    expect(FEATURES.length).toBe(22)
    expect(FEATURE_NAMES).toContain('oi_24h')
    expect(new Set(FEATURES.map((f) => f.group)).size).toBe(7)
  })

  it('price returns are % changes of the close over the stated bars', () => {
    const s = series()
    const v = featureVector(s, I, ctx)!
    expect(v[featureIndex('ret_5m')]).toBeCloseTo((bars.c[I] / bars.c[I - 1] - 1) * 100, 10)
    expect(v[featureIndex('ret_1h')]).toBeCloseTo((bars.c[I] / bars.c[I - 12] - 1) * 100, 10)
    expect(v[featureIndex('ret_24h')]).toBeCloseTo((bars.c[I] / bars.c[I - 288] - 1) * 100, 10)
  })

  it('OI changes use the boundary published at least OI_LAG_MS before T', () => {
    const s = series()
    const T = observationTime(s, I)
    const t1 = oiBoundary(T)
    expect(T - t1).toBeGreaterThanOrEqual(OI_LAG_MS)
    expect(T - t1).toBeLessThan(OI_LAG_MS + BAR_MS)
    const v = featureVector(s, I, ctx)!
    expect(v[featureIndex('oi_1h')]).toBeCloseTo(((oi.get(t1) as number) / (oi.get(t1 - 12 * BAR_MS) as number) - 1) * 100, 10)
  })

  it('volume ratio is 0 (ln 1) for constant volume; realised-vol ratio is finite; distances to the 24h range have the right sign', () => {
    const flat = synthBars(n)
    flat.v = flat.v.map(() => 100)
    const s = prepareSeries({ t: flat.t, h: flat.h, l: flat.l, c: flat.c, v: flat.v })
    const v = featureVector(s, I, { oiAt: (t) => oi.get(t), funding, trend: 0 })!
    for (const k of ['vr_5m', 'vr_15m', 'vr_30m', 'vr_1h']) expect(v[featureIndex(k)]).toBeCloseTo(0, 12)
    expect(Number.isFinite(v[featureIndex('vol_ratio')])).toBe(true)
    expect(v[featureIndex('dist_high_24h')]).toBeLessThanOrEqual(0)
    expect(v[featureIndex('dist_low_24h')]).toBeGreaterThanOrEqual(0)
  })

  it('NO LOOK-AHEAD: changing every bar/OI/funding value after T leaves the vector unchanged', () => {
    const a = featureVector(series(), I, ctx)!
    const poisoned = synthBars(n)
    for (let j = I + 1; j < n; j++) { poisoned.c[j] = 1; poisoned.h[j] = 1e9; poisoned.l[j] = 1e-9; poisoned.v[j] = 1e12 }
    for (let j = 0; j < n; j++) poisoned.c[j] = j <= I ? bars.c[j] : poisoned.c[j]
    const T = bars.t[I] + BAR_MS
    const oi2 = new Map(oi)
    for (const [t] of oi2) if (t > T - OI_LAG_MS) oi2.set(t, 1)
    const fund2: FundingPoint[] = funding.map((f) => (f.t > T ? { ...f, rate: 99 } : f))
    const b = featureVector(prepareSeries({ t: poisoned.t, h: poisoned.h, l: poisoned.l, c: poisoned.c, v: poisoned.v }), I, { oiAt: (t) => oi2.get(t), funding: fund2, trend: 1 })!
    expect(Array.from(b)).toEqual(Array.from(a))
  })

  it('OI newer than the publication lag is not used (a value published "too late" changes nothing)', () => {
    const T = observationTime(series(), I)
    const oi2 = new Map(oi)
    oi2.set(oiBoundary(T) + BAR_MS, 12345) // the next boundary is not published yet at T
    expect(Array.from(featureVector(series(), I, { ...ctx, oiAt: (t) => oi2.get(t) })!)).toEqual(Array.from(featureVector(series(), I, ctx)!))
  })

  it('missing inputs → null, never a guessed value', () => {
    const s = series()
    expect(featureVector(s, I, { ...ctx, oiAt: () => undefined })).toBeNull()
    expect(featureVector(s, I, { ...ctx, oiAt: (t) => (t === oiBoundary(observationTime(s, I)) ? -5 : oi.get(t)) })).toBeNull()
    expect(featureVector(s, I, { ...ctx, funding: funding.slice(0, 3) })).toBeNull()
    expect(featureVector(s, MIN_BAR_INDEX - 1, ctx)).toBeNull()
    expect(featureVector(s, n, ctx)).toBeNull()
  })

  it('deterministic', () => {
    expect(Array.from(featureVector(series(), I, ctx)!)).toEqual(Array.from(featureVector(series(), I, ctx)!))
  })

  it('baseline windows are trailing: BASELINE_BARS of history are needed', () => {
    expect(MIN_BAR_INDEX).toBeGreaterThan(BASELINE_BARS)
  })
})

describe('funding helpers', () => {
  const f: FundingPoint[] = Array.from({ length: 300 }, (_, i) => ({ t: i * 1000, rate: i / 10 }))
  it('fundingIndexAt returns the last settlement at or before T (timestamp handling)', () => {
    expect(fundingIndexAt(f, -1)).toBe(-1)
    expect(fundingIndexAt(f, 0)).toBe(0)
    expect(fundingIndexAt(f, 999)).toBe(0)
    expect(fundingIndexAt(f, 1000)).toBe(1)
    expect(fundingIndexAt(f, 1e12)).toBe(299)
  })
  it('percentile is the rank inside the trailing window, and null with too little history', () => {
    expect(fundingPercentile(f, 299)).toBeCloseTo(1, 12) // highest of its window
    expect(fundingPercentile(f, 50)).toBeNull() // < 90 settlements of history
    const dec: FundingPoint[] = Array.from({ length: 300 }, (_, i) => ({ t: i, rate: 300 - i }))
    expect(fundingPercentile(dec, 299)).toBeCloseTo(1 / 270, 12) // lowest in a 270 window
  })
})
