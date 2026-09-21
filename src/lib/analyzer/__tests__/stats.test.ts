import { describe, expect, it } from 'vitest'
import { binomialTwoSidedP, binomialUpperP, bootstrapMeanCI, decluster, median, mulberry32, normalCdf, sampleClass, wilson } from '../stats'
import { DEFAULT_CONFIG } from '../config'

describe('wilson interval', () => {
  it('matches known reference values', () => {
    const w = wilson(50, 100)
    expect(w.p).toBe(0.5)
    expect(w.lo).toBeCloseTo(0.4038, 3)
    expect(w.hi).toBeCloseTo(0.5962, 3)
    const z = wilson(0, 10)
    expect(z.lo).toBe(0)
    expect(z.hi).toBeCloseTo(0.2775, 3)
    const all = wilson(10, 10)
    expect(all.hi).toBe(1)
    expect(all.lo).toBeCloseTo(0.7225, 3)
  })
  it('is inside [0,1], contains the point estimate and narrows with n', () => {
    for (const [k, n] of [[1, 5], [30, 100], [300, 1000], [999, 1000]] as const) {
      const w = wilson(k, n)
      expect(w.lo).toBeGreaterThanOrEqual(0)
      expect(w.hi).toBeLessThanOrEqual(1)
      expect(w.lo).toBeLessThanOrEqual(w.p)
      expect(w.hi).toBeGreaterThanOrEqual(w.p)
    }
    expect(wilson(500, 1000).hi - wilson(500, 1000).lo).toBeLessThan(wilson(50, 100).hi - wilson(50, 100).lo)
  })
  it('n = 0 yields NaN, never a fabricated probability', () => {
    expect(Number.isNaN(wilson(0, 0).p)).toBe(true)
  })
})

describe('tests and helpers', () => {
  it('normalCdf', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3)
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3)
  })
  it('binomial z-tests: no difference → p≈1, big difference → tiny p, degenerate inputs → 1', () => {
    expect(binomialTwoSidedP(50, 100, 0.5)).toBeCloseTo(1, 6)
    expect(binomialTwoSidedP(70, 100, 0.5)).toBeLessThan(0.001)
    expect(binomialUpperP(70, 100, 0.5)).toBeLessThan(0.001)
    expect(binomialUpperP(30, 100, 0.5)).toBeGreaterThan(0.99)
    expect(binomialTwoSidedP(5, 0, 0.5)).toBe(1)
    expect(binomialTwoSidedP(5, 10, 0)).toBe(1)
  })
  it('sample-size classes follow the configured thresholds', () => {
    const c = (n: number) => sampleClass(n, DEFAULT_CONFIG)
    expect([c(0), c(29), c(30), c(99), c(100), c(299), c(300), c(5000)]).toEqual(['INSUFFICIENT', 'INSUFFICIENT', 'LOW', 'LOW', 'MODERATE', 'MODERATE', 'STRONG', 'STRONG'])
    expect(sampleClass(50, { minSample: { low: 10, moderate: 20, strong: 40 } })).toBe('STRONG')
  })
  it('median / seeded PRNG / bootstrap are deterministic', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    const a = mulberry32(5)
    const b = mulberry32(5)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    const xs = Array.from({ length: 50 }, (_, i) => Math.sin(i))
    expect(bootstrapMeanCI(xs)).toEqual(bootstrapMeanCI(xs))
  })
})

describe('decluster', () => {
  it('keeps the closest analog of a cluster and drops its neighbours within the gap', () => {
    const times = [0, 5, 10, 100, 105]
    const dists = [0.9, 0.2, 0.7, 0.5, 0.6]
    const kept = decluster(times, dists, 30).map((i) => times[i]).sort((a, b) => a - b)
    expect(kept).toEqual([5, 100]) // 5 beats 0/10; 100 beats 105
  })
  it('is deterministic and keeps everything when analogs are far apart', () => {
    const times = [0, 100, 200]
    expect(decluster(times, [0.3, 0.2, 0.1], 50).length).toBe(3)
    expect(decluster(times, [0.3, 0.3, 0.3], 50)).toEqual(decluster(times, [0.3, 0.3, 0.3], 50))
  })
  it('kept analogs are always at least gap apart', () => {
    const times = Array.from({ length: 200 }, (_, i) => i * 15)
    const dists = times.map((_, i) => (i * 37) % 11)
    const kept = decluster(times, dists, 60).map((i) => times[i]).sort((a, b) => a - b)
    for (let i = 1; i < kept.length; i++) expect(kept[i] - kept[i - 1]).toBeGreaterThanOrEqual(60)
  })
})
