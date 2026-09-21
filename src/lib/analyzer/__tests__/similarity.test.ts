import { describe, expect, it } from 'vitest'
import { FEATURES, FEATURE_GROUPS, featureIndex } from '../features'
import { FEATURE_WEIGHTS, Z_CLIP, distance, fitScaler, groupGaps, transformVector } from '../similarity'
import { mulberry32 } from '../stats'

const F = FEATURES.length
function rows(n: number, seed = 3): Float64Array {
  const r = mulberry32(seed)
  const m = new Float64Array(n * F)
  for (let i = 0; i < n; i++) for (let f = 0; f < F; f++) m[i * F + f] = FEATURES[f].scaled ? (r() - 0.5) * (f + 1) : Math.floor(r() * 3) - 1
  return m
}

describe('robust scaler', () => {
  it('is fitted on the first nFit rows only: rows after nFit cannot change it (no leakage into the geometry)', () => {
    const a = rows(400)
    const b = Float64Array.from(a)
    for (let i = 300 * F; i < b.length; i++) b[i] = 1e6
    const sa = fitScaler(a, F, 300)
    const sb = fitScaler(b, F, 300)
    expect(Array.from(sb.median)).toEqual(Array.from(sa.median))
    expect(Array.from(sb.scale)).toEqual(Array.from(sa.scale))
  })
  it('centres on the median, scales by 1.4826·MAD, clips at ±5 and leaves the regime feature untouched', () => {
    const m = rows(500)
    const sc = fitScaler(m, F, 500)
    const x = new Float64Array(F)
    for (let f = 0; f < F; f++) x[f] = sc.median[f]
    x[featureIndex('trend_4h')] = -1
    const z = transformVector(sc, x)
    expect(Math.abs(z[0])).toBeLessThan(1e-6)
    expect(z[featureIndex('trend_4h')]).toBe(-1)
    x[0] = 1e9
    expect(transformVector(sc, x)[0]).toBe(Z_CLIP)
    x[0] = -1e9
    expect(transformVector(sc, x)[0]).toBe(-Z_CLIP)
  })
  it('constant features do not create NaN/Infinity', () => {
    const m = new Float64Array(200 * F)
    const sc = fitScaler(m, F, 200)
    expect(Array.from(sc.scale).every((s) => s > 0 && Number.isFinite(s))).toBe(true)
  })
})

describe('group-weighted distance', () => {
  it('weights: every group carries exactly 1/G of the squared distance', () => {
    expect(FEATURE_WEIGHTS.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
    for (const g of FEATURE_GROUPS) {
      const w = FEATURES.reduce((a, f, i) => a + (f.group === g ? FEATURE_WEIGHTS[i] : 0), 0)
      expect(w).toBeCloseTo(1 / FEATURE_GROUPS.length, 12)
    }
  })
  it('identity, symmetry, non-negativity', () => {
    const a = new Float32Array(F).map((_, i) => Math.sin(i))
    const b = new Float32Array(F).map((_, i) => Math.cos(i))
    expect(distance(a, a)).toBe(0)
    expect(distance(a, b)).toBeCloseTo(distance(b, a), 12)
    expect(distance(a, b)).toBeGreaterThan(0)
  })
  it('a shift of 1 σ in every feature gives distance 1 (RMS z-gap)', () => {
    const a = new Float32Array(F)
    const b = new Float32Array(F).fill(1)
    expect(distance(a, b)).toBeCloseTo(1, 6)
  })
  it('a group with many features cannot dominate a group with one (regime vs price)', () => {
    const a = new Float32Array(F)
    const price = new Float32Array(F)
    FEATURES.forEach((f, i) => { if (f.group === 'PRICE') price[i] = 1 })
    const regime = new Float32Array(F)
    regime[featureIndex('trend_4h')] = 1
    expect(distance(a, price)).toBeCloseTo(distance(a, regime), 12) // 6 features shifted by 1 == 1 feature shifted by 1
  })
  it('opposite regimes are farther than adjacent ones (regime filtering is a soft penalty)', () => {
    const base = new Float32Array(F)
    base[featureIndex('trend_4h')] = 1
    const adjacent = new Float32Array(F)
    const opposite = new Float32Array(F)
    opposite[featureIndex('trend_4h')] = -1
    expect(distance(base, opposite)).toBeGreaterThan(distance(base, adjacent))
  })
  it('groupGaps reports the per-group mean squared gap', () => {
    const a = new Float32Array(F)
    const z = new Float32Array(F)
    FEATURES.forEach((f, i) => { if (f.group === 'OI') z[i] = 2 })
    const g = groupGaps(a, z, 0)
    expect(g.OI).toBeCloseTo(4, 12)
    expect(g.PRICE).toBe(0)
  })
})
