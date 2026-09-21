import { describe, expect, it } from 'vitest'
import { baseline, bootstrapMeanCI, firstPassage, forward, independentCount, splitOf, summarize, TRAIN_END, VAL_END, DATA_START, DATA_END, type Bar } from '../lib'
import { replayScalp } from '../scalpReplay'
import { runSmartAlert, type SnapshotSeries } from '../smartReplay'
import type { Kline } from '../download'
import type { MetricSnapshot } from '../../../src/types/smartAlert'
import { mulberry32 } from '../lib'

const bars = (closes: number[], step = 300_000): Bar[] =>
  closes.map((c, i) => ({ t: i * step, o: i ? closes[i - 1] : c, h: Math.max(c, i ? closes[i - 1] : c) * 1.001, l: Math.min(c, i ? closes[i - 1] : c) * 0.999, c, ct: i * step + step - 1 }))

describe('lib: split, forward evaluation, statistics', () => {
  it('splits chronologically 60/20/20 and never overlaps', () => {
    expect((TRAIN_END - DATA_START) / (DATA_END - DATA_START)).toBeCloseTo(0.6, 10)
    expect((VAL_END - DATA_START) / (DATA_END - DATA_START)).toBeCloseTo(0.8, 10)
    expect(splitOf(DATA_START)).toBe('train')
    expect(splitOf(TRAIN_END)).toBe('val')
    expect(splitOf(VAL_END)).toBe('oos')
  })

  it('forward() uses only bars after the signal bar: changing the past or the signal bar internals changes nothing', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106]
    const a = bars(closes)
    const b = bars(closes)
    b[0] = { ...b[0], c: 1, h: 1, l: 1 } // corrupt history before the signal
    const fa = forward(a, 3, 1, 2)!
    const fb = forward(b, 3, 1, 2)!
    expect(fa).toEqual(fb)
    expect(fa.ret).toBeCloseTo(105 / 103 - 1, 12)
  })

  it('forward() returns null when the horizon runs past the data (no partial/lookahead-free fudge)', () => {
    expect(forward(bars([1, 2, 3]), 2, 1, 1)).toBeNull()
  })

  it('short direction inverts returns and swaps favourable/adverse excursions', () => {
    const b = bars([100, 100, 90])
    const long = forward(b, 1, 1, 1)!
    const short = forward(b, 1, -1, 1)!
    expect(short.ret).toBeCloseTo(-long.ret, 12)
    expect(short.mfe).toBeCloseTo(-long.mae, 12)
  })

  it('firstPassage counts a same-bar double touch as adverse (conservative)', () => {
    const b: Bar[] = [
      { t: 0, o: 100, h: 100, l: 100, c: 100, ct: 1 },
      { t: 1, o: 100, h: 101, l: 99, c: 100, ct: 2 }, // touches +1% and -1% in one bar
    ]
    expect(firstPassage(b, 0, 1, 1, 0.01)).toBe('adverse')
    expect(firstPassage(b, 0, -1, 1, 0.01)).toBe('adverse')
  })

  it('bootstrap CI and summarize() are deterministic', () => {
    const rnd = mulberry32(7)
    const xs = Array.from({ length: 200 }, () => rnd() - 0.5)
    expect(bootstrapMeanCI(xs)).toEqual(bootstrapMeanCI(xs))
    const bb = bars(Array.from({ length: 500 }, (_, i) => 100 + Math.sin(i / 9) * 5 + i * 0.01))
    const evs = [10, 60, 200, 300].map((i) => ({ i, dir: 1 as const, t: bb[i].ct }))
    const h = [{ label: '1', bars: 1 }, { label: '10', bars: 10 }]
    expect(summarize(bb, evs, h, 0, 1e12)).toEqual(summarize(bb, evs, h, 0, 1e12))
  })

  it('baseline is the unconditional mean and is memoised without changing its value', () => {
    const bb = bars([100, 101, 102, 103, 104])
    const v1 = baseline(bb, 1, 1, 0, 1e12)
    const v2 = baseline(bb, 1, 1, 0, 1e12)
    expect(v1).toBe(v2)
    expect(v1).toBeCloseTo((101 / 100 + 102 / 101 + 103 / 102 + 104 / 103 - 4) / 4, 12)
  })

  it('independentCount de-clusters overlapping events', () => {
    const ev = [0, 1, 2, 10, 11, 30].map((i) => ({ i, dir: 1 as const, t: i }))
    expect(independentCount(ev, 10)).toBe(3)
  })
})

/** Synthetic multi-timeframe BTC-like series (seeded): trending legs + noise, consistent 15m/1h/4h. */
function synthetic(nBars15: number): { k15: Kline[]; k1h: Kline[]; k4h: Kline[] } {
  const rnd = mulberry32(2024)
  const M15 = 900_000
  const k15: Kline[] = []
  let p = 20_000
  for (let i = 0; i < nBars15; i++) {
    const trend = Math.sin(i / 700) * 0.0009 + Math.sin(i / 90) * 0.0006
    const o = p
    const c = o * (1 + trend + (rnd() - 0.5) * 0.004)
    const h = Math.max(o, c) * (1 + rnd() * 0.0015)
    const l = Math.min(o, c) * (1 - rnd() * 0.0015)
    k15.push({ t: i * M15, o, h, l, c, v: 100 + rnd() * 100, ct: i * M15 + M15 - 1 })
    p = c
  }
  const agg = (n: number): Kline[] => {
    const out: Kline[] = []
    for (let i = 0; i + n <= k15.length; i += n) {
      const s = k15.slice(i, i + n)
      out.push({ t: s[0].t, o: s[0].o, h: Math.max(...s.map((k) => k.h)), l: Math.min(...s.map((k) => k.l)), c: s[n - 1].c, v: s.reduce((a, k) => a + k.v, 0), ct: s[n - 1].ct })
    }
    return out
  }
  return { k15, k1h: agg(4), k4h: agg(16) }
}

describe('replayScalp: determinism and no look-ahead (truncation invariance)', () => {
  const { k15, k1h, k4h } = synthetic(30_000)
  const full = replayScalp(k15, k1h, k4h)

  it('produces alerts on the synthetic series (the property below is not vacuous)', () => {
    expect(full.events.length).toBeGreaterThan(12)
  })

  it('same data + config => identical events and trades on every run', () => {
    const again = replayScalp(k15, k1h, k4h)
    expect(again.events).toEqual(full.events)
    expect(again.trades).toEqual(full.trades)
  })

  it('events up to time T are unchanged when ALL data after T is removed (the engine cannot see the future)', () => {
    for (const frac of [0.3, 0.6, 0.9]) {
      const T = full.events[Math.floor(full.events.length * frac)].t
      const trunc = replayScalp(k15.filter((k) => k.ct <= T), k1h.filter((k) => k.ct <= T), k4h.filter((k) => k.ct <= T))
      const fullUpToT = full.events.filter((e) => e.t <= T)
      expect(trunc.events.length).toBeGreaterThan(0)
      expect(trunc.events).toEqual(fullUpToT)
    }
  })

  it('events up to time T are unchanged when the future is REPLACED by garbage', () => {
    const T = full.events[Math.floor(full.events.length * 0.5)].t
    const junk = (arr: Kline[]) => arr.map((k) => (k.ct > T ? { ...k, o: 1, h: 1e9, l: 1e-9, c: 5, v: 1 } : k))
    const poisoned = replayScalp(junk(k15), junk(k1h), junk(k4h))
    expect(poisoned.events.filter((e) => e.t <= T)).toEqual(full.events.filter((e) => e.t <= T))
  })
})

describe('runSmartAlert: state machine on a hand-built snapshot series', () => {
  const snap = (price24h: number, oi15: number, funding: number): MetricSnapshot => ({
    symbol: 'BTC', timestamp: 0, price: 100, priceChangePct: price24h, openInterest: null,
    openInterestChangePct: { '15m': oi15 }, fundingRate: funding, volume: null, volumeChangePct: { '15m': 0 }, rsi: { '1h': 50 },
    longLiquidations: null, shortLiquidations: null, liquidationSpike: null,
  })
  // reversal_watch: 24h change <= -0.5, OI15m >= 1, funding <= 0
  const match = snap(-1, 2, -0.01)
  const no = snap(1, 0, 0.01)
  const mk = (pattern: MetricSnapshot[]): SnapshotSeries => ({
    t: pattern.map((_, i) => (i + 1) * 300_000), // 5-min steps, like the replay
    snapshots: pattern, barIndex: pattern.map((_, i) => i), ret1h: [], oi1hChange: [],
  })

  it('fires once per confirmed streak and invalidates it afterwards', () => {
    const ev = runSmartAlert(mk([no, match, match, no, no]), { presetId: 'reversal_watch', confirmationCycles: 1 })
    expect(ev.map((e) => e.kind)).toEqual(['fired', 'invalidated'])
  })

  it('an unconfirmed blip (2 cycles required, 1 seen) neither fires nor announces an invalidation', () => {
    const ev = runSmartAlert(mk([match, match, match, no, match, no, no]), { presetId: 'reversal_watch', confirmationCycles: 2 })
    // streak 1 (3 matches) fires at its 2nd cycle and is invalidated; streak 2 (1 match) must be silent
    expect(ev.map((e) => e.kind)).toEqual(['fired', 'invalidated'])
  })
})
