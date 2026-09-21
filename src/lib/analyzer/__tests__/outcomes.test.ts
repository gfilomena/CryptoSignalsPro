import { describe, expect, it } from 'vitest'
import { pathOutcome } from '../outcomes'

describe('pathOutcome', () => {
  // entry 100; following bars (h,l,c): up to 110 then down to 95 then 105
  const h = [102, 110, 104, 106]
  const l = [99, 101, 95, 100]
  const c = [101, 108, 96, 105]
  it('computes return, MFE, MAE, drawdown and times from the bars after the entry', () => {
    const o = pathOutcome(100, h, l, c, 0, 4)!
    expect(o.ret).toBeCloseTo(0.05, 12)
    expect(o.mfe).toBeCloseTo(0.1, 12)
    expect(o.mae).toBeCloseTo(-0.05, 12)
    expect(o.maxDrawdown).toBeCloseTo(96 / 108 - 1, 12)
    expect(o.barsToMfe).toBe(2)
    expect(o.barsToMae).toBe(3)
  })
  it('short horizons only see their own bars', () => {
    const o = pathOutcome(100, h, l, c, 0, 2)!
    expect(o.ret).toBeCloseTo(0.08, 12)
    expect(o.mae).toBeCloseTo(-0.01, 12)
  })
  it('returns null when the horizon is not yet knowable or inputs are invalid', () => {
    expect(pathOutcome(100, h, l, c, 0, 5)).toBeNull()
    expect(pathOutcome(100, h, l, c, 2, 3)).toBeNull()
    expect(pathOutcome(0, h, l, c, 0, 2)).toBeNull()
  })
  it('does not read past the horizon (future bars cannot change the outcome)', () => {
    const a = pathOutcome(100, h, l, c, 0, 2)!
    const b = pathOutcome(100, [...h.slice(0, 2), 999, 999], [...l.slice(0, 2), -999, -999], [...c.slice(0, 2), 1, 1], 0, 2)!
    expect(b).toEqual(a)
  })
})
