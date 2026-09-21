import { describe, expect, it } from 'vitest'
import { addRecord, alignment, mergeRecords, needsResolution, resolveAll, resolveRecord, summarizePerformance, type AnalysisRecord, type FuturePath } from '../history'
import { BAR_MS } from '../config'

const base = (over: Partial<AnalysisRecord> = {}): AnalysisRecord => ({
  id: 'a', createdAt: 1, snapshotTimeMs: 1_000_000, symbol: 'BTCUSDT', entryPrice: 100, display: {} as never, vector: [], storeVersion: 'v', tau: 1, windowDays: null,
  nAnalogs: 10, bias: 'BULLISH', strength: 20, confirmation: 'NONE', horizons: [], engineState: 'WATCH', alignment: 'CONFLICTING', outcomes: {}, ...over,
})
// 300 five-minute bars after the snapshot: price rises 0.1 per bar from 100
const path = (n = 300): FuturePath => ({ h: Array.from({ length: n }, (_, i) => 100.5 + i * 0.1), l: Array.from({ length: n }, (_, i) => 99.5 + i * 0.1), c: Array.from({ length: n }, (_, i) => 100.1 + i * 0.1) })

describe('engine alignment (never auto-resolved)', () => {
  it('matches the spec examples', () => {
    expect(alignment(null, true, 'BULLISH')).toBe('CONFLICTING') // engine WAIT, analyzer bullish
    expect(alignment('short', false, 'BEARISH')).toBe('ALIGNED')
    expect(alignment('long', false, 'BEARISH')).toBe('CONFLICTING')
    expect(alignment(null, true, 'NEUTRAL')).toBe('ALIGNED')
    expect(alignment('long', false, 'NEUTRAL')).toBe('CONFLICTING')
    expect(alignment('long', false, 'INSUFFICIENT')).toBe('NOT_COMPARABLE')
    expect(alignment(null, false, 'BULLISH')).toBe('NOT_COMPARABLE')
  })
})

describe('post-event validation', () => {
  const T = 1_000_000
  it('resolves only the horizons whose time has passed, from the observation close', () => {
    const now = T + 20 * 60_000 // +20 min: 5m and 15m are due, 30m is not
    const r = resolveRecord(base(), path(), now)
    expect(Object.keys(r.outcomes).sort()).toEqual(['15m', '5m'])
    expect(r.outcomes['5m'].ret).toBeCloseTo(100.1 / 100 - 1, 12)
    expect(r.outcomes['15m'].ret).toBeCloseTo(100.3 / 100 - 1, 12)
    expect(r.outcomes['15m'].mfe).toBeCloseTo(100.7 / 100 - 1, 12)
  })
  it('nothing is resolved before the first horizon; everything by +24h; already-resolved outcomes are never overwritten', () => {
    expect(Object.keys(resolveRecord(base(), path(), T + 60_000).outcomes)).toEqual([])
    const done = resolveRecord(base(), path(), T + 25 * 3_600_000)
    expect(Object.keys(done.outcomes).sort()).toEqual(['15m', '1h', '24h', '30m', '4h', '5m'])
    const again = resolveRecord({ ...done, outcomes: { ...done.outcomes, '5m': { ...done.outcomes['5m'], ret: 42 } } }, path(), T + 25 * 3_600_000)
    expect(again.outcomes['5m'].ret).toBe(42)
  })
  it('a path that is too short leaves the horizon unresolved (never a partial outcome)', () => {
    const r = resolveRecord(base(), path(10), T + 25 * 3_600_000)
    expect(r.outcomes['1h']).toBeUndefined()
    expect(r.outcomes['5m']).toBeDefined()
  })
  it('needsResolution / resolveAll fetch once per due record and survive fetch failures', async () => {
    const recs = [base({ id: 'due' }), base({ id: 'notdue', snapshotTimeMs: T + 10 * 3_600_000 }), base({ id: 'fails' })]
    expect(needsResolution(recs[0], T + BAR_MS)).toBe(true)
    expect(needsResolution(recs[1], T + 60_000)).toBe(false)
    let calls = 0
    const out = await resolveAll(recs, T + 2 * 3_600_000, async () => { calls++; if (calls === 2) throw new Error('net'); return path() })
    expect(out.records.find((r) => r.id === 'due')!.outcomes['1h']).toBeDefined()
    expect(out.records.find((r) => r.id === 'fails')!.outcomes['1h']).toBeUndefined()
    expect(out.changed.map((r) => r.id)).toEqual(['due'])
  })
})

describe('history store and dashboard numbers', () => {
  it('addRecord de-duplicates by id and newest first; merge keeps the copy with more outcomes', () => {
    const one = base({ id: 'x', createdAt: 5 })
    const list = addRecord(addRecord([], one), base({ id: 'y', createdAt: 9 }))
    expect(list.map((r) => r.id)).toEqual(['y', 'x'])
    const resolved = { ...one, outcomes: { '5m': { ret: 0.01, mfe: 0, mae: 0, maxDrawdown: 0, resolvedAt: 1 } } }
    expect(mergeRecords([one], [resolved])[0].outcomes['5m']).toBeDefined()
  })
  it('summary counts real resolved outcomes only', () => {
    const o = (ret: number) => ({ ret, mfe: 0, mae: 0, maxDrawdown: 0, resolvedAt: 1 })
    const recs = [
      base({ id: '1', bias: 'BULLISH', outcomes: { '30m': o(0.01), '1h': o(0.02) } }),
      base({ id: '2', bias: 'BULLISH', outcomes: { '30m': o(-0.01) } }),
      base({ id: '3', bias: 'BEARISH', outcomes: { '30m': o(-0.03) } }),
      base({ id: '4', bias: 'NEUTRAL', outcomes: {} }),
      base({ id: '5', bias: 'INSUFFICIENT', outcomes: {} }),
    ]
    const s = summarizePerformance(recs)
    expect([s.total, s.bullish, s.bearish, s.neutral, s.insufficient]).toEqual([5, 2, 1, 1, 1])
    expect(s.byHorizon['30m'].resolved).toBe(3)
    expect(s.byHorizon['30m'].pPositive).toBeCloseTo(1 / 3, 12)
    expect(s.byHorizon['30m'].meanRet).toBeCloseTo((0.01 - 0.01 - 0.03) / 3, 12)
    expect(s.byHorizon['30m'].medianRet).toBeCloseTo(-0.01, 12)
    expect(s.byHorizon['5m'].resolved).toBe(0)
    expect(s.byHorizon['5m'].pPositive).toBeNull()
    expect(s.byBias.BULLISH['30m'].resolved).toBe(2)
    expect(s.byBias.BEARISH['1h'].resolved).toBe(0)
  })
})
