import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type AnalyzerConfig } from '../config'
import { analyze, classifyBias, type HorizonResult } from '../analyzer'
import { synthStore } from './testUtils'
import { decodeStore, encodeStore, type AnalyzerStore } from '../store'
import { featureIndex } from '../features'

const store = synthStore(9000, 1.3)
const cfg: AnalyzerConfig = { ...DEFAULT_CONFIG, thresholdBase: store.meta.thresholdBase }
const F = store.F
const row = (r: number) => Array.from(store.raw.subarray(r * F, (r + 1) * F))
const Q = Math.floor(store.n * 0.85)
const query = { t: store.times[Q], vector: row(Q) }
const DAY = 86_400_000

describe('analyze — determinism and structure', () => {
  const a = analyze(store, query, cfg, { anchorMs: query.t, maxAnalogTimeMs: query.t - DAY, oosValidity: 0.4 })
  it('same input → identical output (reproducible)', () => {
    const b = analyze(store, query, cfg, { anchorMs: query.t, maxAnalogTimeMs: query.t - DAY, oosValidity: 0.4 })
    expect(b).toEqual(a)
    // and identical when the store is rebuilt from scratch
    expect(analyze(synthStore(9000, 1.3), query, cfg, { anchorMs: query.t, maxAnalogTimeMs: query.t - DAY, oosValidity: 0.4 })).toEqual(a)
  })
  it('every probability is a valid Wilson interval on the effective N, and N_eff <= N_raw', () => {
    for (const h of a.horizons) {
      expect(h.nEff).toBeLessThanOrEqual(h.nRaw)
      for (const p of [h.pPositive, h.pNegative, ...Object.values(h.pUp), ...Object.values(h.pDown)]) {
        expect(p.n).toBe(h.nEff)
        if (p.n > 0) {
          expect(p.lo).toBeLessThanOrEqual(p.p + 1e-12)
          expect(p.hi).toBeGreaterThanOrEqual(p.p - 1e-12)
          expect(p.lo).toBeGreaterThanOrEqual(0)
          expect(p.hi).toBeLessThanOrEqual(1)
        }
      }
      expect(h.pPositive.p + h.pNegative.p).toBeLessThanOrEqual(1 + 1e-12)
    }
  })
  it('reports all seven horizons, baselines and the extra baselines', () => {
    expect(a.horizons.map((h) => h.horizon)).toEqual(['5m', '15m', '30m', '1h', '4h', '12h', '24h'])
    const h = a.horizons.find((x) => x.horizon === '1h')!
    expect(h.baseline.all.n).toBeGreaterThan(0)
    expect(h.baseline.sameRegime).not.toBeNull()
    expect(h.baseline.sameMomentum).not.toBeNull()
  })
  it('strength is null when evidence is insufficient, otherwise within [0,100] and consistent with the components', () => {
    if (a.bias === 'INSUFFICIENT') expect(a.strength).toBeNull()
    else {
      expect(a.strength).toBeGreaterThanOrEqual(0)
      expect(a.strength).toBeLessThanOrEqual(100)
      expect(a.components).not.toBeNull()
    }
  })
  it('robustness table covers 0.8/0.9/1.0/1.1 and analogs grow with the threshold', () => {
    const rows = a.robustness!.rows
    expect(rows.map((r) => r.multiplier)).toEqual([0.8, 0.9, 1, 1.1])
    for (let i = 1; i < rows.length; i++) expect(rows[i].nAnalogs).toBeGreaterThanOrEqual(rows[i - 1].nAnalogs)
  })
  it('recency windows are nested (a longer window never has fewer analogs)', () => {
    const w = a.windows!
    for (let i = 1; i < w.length; i++) expect(w[i].nAnalogs).toBeGreaterThanOrEqual(w[i - 1].nAnalogs)
    expect(w[w.length - 1].days).toBeNull()
  })
  it('group breakdown covers every group with a match level', () => {
    expect(a.groups!.length).toBe(7)
    for (const g of a.groups!) expect(['HIGH', 'MODERATE', 'LOW']).toContain(g.level)
  })
})

describe('analyze — analog selection and look-ahead protection', () => {
  it('a query identical to a historical row finds that row at distance 0 (when it is in the pool)', () => {
    const r = 500
    const res = analyze(store, { t: store.times[r] + 1, vector: row(r) }, cfg, { light: true })
    expect(res.distance.min).toBeCloseTo(0, 6)
  })
  it('a tiny threshold selects (almost) nobody → INSUFFICIENT, no fabricated statistics', () => {
    const res = analyze(store, query, { ...cfg, thresholdBase: 1e-6 }, { anchorMs: query.t })
    expect(res.bias).toBe('INSUFFICIENT')
    expect(res.strength).toBeNull()
    expect(res.confirmation).toBe('NONE')
  })
  it('maxAnalogTimeMs removes every later analog: pool ends before the cut', () => {
    const cut = store.times[Math.floor(store.n * 0.5)]
    const res = analyze(store, query, cfg, { light: true, maxAnalogTimeMs: cut })
    expect(res.poolToMs).toBeLessThanOrEqual(cut)
  })
  it('NO LOOK-AHEAD: replacing all price bars after the query time does not change a validation-style result', () => {
    const T = query.t
    const opts = { light: true, anchorMs: T, maxAnalogTimeMs: T - DAY } as const
    const clean = analyze(store, query, cfg, opts)
    // poison bars strictly after T (outcomes of analogs must all end before T because of the 24h guard)
    const poisoned: AnalyzerStore = { ...store, bars: { t0: store.bars.t0, c: store.bars.c.slice(), h: store.bars.h.slice(), l: store.bars.l.slice() } }
    const firstFuture = Math.round((T - store.bars.t0) / 300_000) + 1
    for (let i = firstFuture; i < poisoned.bars.c.length; i++) { poisoned.bars.c[i] = 1; poisoned.bars.h[i] = 1e9; poisoned.bars.l[i] = 1e-9 }
    expect(analyze(poisoned, query, cfg, opts)).toEqual(clean)
  })
  it('the analog set does not depend on outcomes: same vector, different outcome bars → same analogs', () => {
    const other = decodeStore(encodeStore({
      meta: { symbol: 'T', trainEndMs: store.meta.trainEndMs, valEndMs: store.meta.valEndMs, dataStartMs: store.meta.dataStartMs, dataEndMs: store.meta.dataEndMs, thresholdBase: 1.3, t0Bars: store.meta.t0Bars, builtAt: '', source: '' },
      times: Array.from(store.times),
      rows: Array.from({ length: store.n }, (_, r) => Float64Array.from(store.raw.subarray(r * F, (r + 1) * F))),
      bars: { c: store.bars.c.map((x) => x * 2), h: store.bars.h.map((x) => x * 2), l: store.bars.l.map((x) => x * 2) },
    }))
    const a = analyze(store, query, cfg, { light: true })
    const b = analyze(other, query, cfg, { light: true })
    expect(b.nAnalogs).toBe(a.nAnalogs)
    expect(b.distance.mean).toBeCloseTo(a.distance.mean, 4)
  })
  it('regime is a soft filter: a query in one trend regime matches analogs from other regimes only at a distance penalty', () => {
    const tIdx = featureIndex('trend_4h')
    const v = [...query.vector]
    v[tIdx] = 1
    const up = analyze(store, { t: query.t, vector: v }, cfg, { light: true })
    v[tIdx] = -1
    const down = analyze(store, { t: query.t, vector: v }, cfg, { light: true })
    expect(up.nAnalogs).not.toBe(down.nAnalogs)
  })
})

describe('bias rule', () => {
  const mk = (horizon: string, sep: HorizonResult['separation']): HorizonResult => ({ horizon, separation: sep }) as HorizonResult
  it('needs two usable bias horizons; two same-direction separations and no opposite → directional', () => {
    expect(classifyBias([mk('30m', 'ABOVE'), mk('1h', 'ABOVE'), mk('4h', 'NONE')])).toBe('BULLISH')
    expect(classifyBias([mk('30m', 'BELOW'), mk('1h', 'BELOW'), mk('4h', 'NA')])).toBe('BEARISH')
    expect(classifyBias([mk('30m', 'ABOVE'), mk('1h', 'BELOW'), mk('4h', 'NONE')])).toBe('NEUTRAL')
    expect(classifyBias([mk('30m', 'ABOVE'), mk('1h', 'NONE'), mk('4h', 'NONE')])).toBe('NEUTRAL')
    expect(classifyBias([mk('30m', 'ABOVE'), mk('1h', 'NA'), mk('4h', 'NA')])).toBe('INSUFFICIENT')
    expect(classifyBias([mk('5m', 'ABOVE'), mk('15m', 'ABOVE'), mk('12h', 'ABOVE')])).toBe('INSUFFICIENT') // non-bias horizons are ignored
  })
})
