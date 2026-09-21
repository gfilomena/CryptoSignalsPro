import { describe, expect, it } from 'vitest'
import { confirmationLabel, evidenceFromP, sampleComponent, strengthFromComponents } from '../strength'
import { DEFAULT_CONFIG } from '../config'

describe('Setup Strength', () => {
  const ones = { n: 1, sim: 1, sep: 1, cons: 1, rob: 1, oos: 1 }
  it('= 100 · geometric mean of the five in-sample components · out-of-sample validity', () => {
    expect(strengthFromComponents(ones)).toBe(100)
    expect(strengthFromComponents({ ...ones, n: 0.5, sim: 0.5, sep: 0.5, cons: 0.5, rob: 0.5, oos: 1 })).toBe(50)
    const c = { n: 0.8, sim: 0.4, sep: 0.6, cons: 1, rob: 0.75, oos: 0.2 }
    expect(strengthFromComponents(c)).toBeCloseTo(100 * Math.pow(0.8 * 0.4 * 0.6 * 1 * 0.75, 1 / 5) * 0.2, 1)
  })
  it('a method without out-of-sample validity can never look strong: strength <= 100 · S_oos', () => {
    expect(strengthFromComponents({ n: 1, sim: 1, sep: 1, cons: 1, rob: 1, oos: 0.18 })).toBeLessThanOrEqual(18)
    expect(strengthFromComponents({ ...ones, oos: 0 })).toBe(0)
  })
  it('weakest-link: a single zero in-sample component zeroes the score; out-of-range inputs are clamped; NaN counts as 0', () => {
    expect(strengthFromComponents({ ...ones, sim: 0 })).toBe(0)
    expect(strengthFromComponents({ ...ones, n: 5 })).toBe(100)
    expect(strengthFromComponents({ ...ones, sep: NaN })).toBe(0)
  })
  it('is monotone in every component', () => {
    const base = { n: 0.5, sim: 0.5, sep: 0.5, cons: 0.5, rob: 0.5, oos: 0.5 }
    for (const k of Object.keys(base) as (keyof typeof base)[]) {
      expect(strengthFromComponents({ ...base, [k]: 0.9 })).toBeGreaterThan(strengthFromComponents(base))
    }
  })
  it('p-value evidence scale: log10, saturating at p = 0.001; a non-significant p is never "70 %"', () => {
    expect(evidenceFromP(0.001)).toBeCloseTo(1, 12)
    expect(evidenceFromP(0.0001)).toBe(1)
    expect(evidenceFromP(0.05)).toBeCloseTo(0.4337, 3)
    expect(evidenceFromP(0.3)).toBeCloseTo(0.1743, 3)
    expect(evidenceFromP(1)).toBe(0)
    expect(evidenceFromP(NaN)).toBe(0)
  })
  it('sample component grows with n_eff and saturates at N_strong', () => {
    expect(sampleComponent(0, DEFAULT_CONFIG)).toBe(0)
    expect(sampleComponent(30, DEFAULT_CONFIG)).toBeLessThan(sampleComponent(100, DEFAULT_CONFIG))
    expect(sampleComponent(300, DEFAULT_CONFIG)).toBeCloseTo(1, 12)
    expect(sampleComponent(10_000, DEFAULT_CONFIG)).toBe(1)
  })
  it('confirmation label uses configurable bins; no score → NONE', () => {
    expect([confirmationLabel(75, DEFAULT_CONFIG), confirmationLabel(45, DEFAULT_CONFIG), confirmationLabel(25, DEFAULT_CONFIG), confirmationLabel(5, DEFAULT_CONFIG), confirmationLabel(null, DEFAULT_CONFIG)]).toEqual(['STRONG', 'MODERATE', 'WEAK', 'NONE', 'NONE'])
  })
})
