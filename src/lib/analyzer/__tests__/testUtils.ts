import { BAR_MS, MIN_BAR_INDEX } from '../config'
import { featureVector, prepareSeries, type FundingPoint } from '../features'
import { decodeStore, encodeStore, type AnalyzerStore } from '../store'
import { mulberry32 } from '../stats'

export interface SynthBars { t: number[]; h: number[]; l: number[]; c: number[]; v: number[] }

/** Seeded 5-minute random-walk bars starting at `t0` (aligned to 15 minutes). */
export function synthBars(n: number, seed = 7, t0 = Date.UTC(2024, 0, 1)): SynthBars {
  const rnd = mulberry32(seed)
  const out: SynthBars = { t: [], h: [], l: [], c: [], v: [] }
  let p = 40_000
  for (let i = 0; i < n; i++) {
    const ret = (rnd() - 0.5) * 0.004 + Math.sin(i / 400) * 0.0003
    const o = p
    p = o * (1 + ret)
    out.t.push(t0 + i * BAR_MS)
    out.h.push(Math.max(o, p) * (1 + rnd() * 0.0008))
    out.l.push(Math.min(o, p) * (1 - rnd() * 0.0008))
    out.c.push(p)
    out.v.push(100 + rnd() * 200)
  }
  return out
}

export function synthOi(bars: SynthBars, seed = 11): Map<number, number> {
  const rnd = mulberry32(seed)
  const m = new Map<number, number>()
  let oi = 80_000
  for (const t of bars.t) {
    oi *= 1 + (rnd() - 0.5) * 0.002
    m.set(t, oi)
  }
  return m
}

export function synthFunding(bars: SynthBars, seed = 13): FundingPoint[] {
  const rnd = mulberry32(seed)
  const out: FundingPoint[] = []
  const start = bars.t[0] - 120 * 86_400_000
  const end = bars.t[bars.t.length - 1]
  for (let t = start; t <= end; t += 8 * 3_600_000) out.push({ t, rate: 0.01 + (rnd() - 0.5) * 0.02 })
  return out
}

/** Full synthetic store built through the same code path as scripts/analyzer/buildStore.ts. */
export function synthStore(n = 6000, thresholdBase = 1.2): AnalyzerStore {
  const b = synthBars(n)
  const series = prepareSeries({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v })
  const oi = synthOi(b)
  const funding = synthFunding(b)
  const times: number[] = []
  const rows: Float64Array[] = []
  for (let i = MIN_BAR_INDEX; i < series.n; i++) {
    const T = series.t[i] + BAR_MS
    if (T % 900_000 !== 0) continue
    const v = featureVector(series, i, { oiAt: (t) => oi.get(t), funding, trend: ((i >> 9) % 3) - 1 as -1 | 0 | 1 })
    if (v) { times.push(T); rows.push(v) }
  }
  const span = times[times.length - 1] - times[0]
  return decodeStore(encodeStore({
    meta: {
      symbol: 'TEST', trainEndMs: times[0] + 0.6 * span, valEndMs: times[0] + 0.8 * span,
      dataStartMs: times[0], dataEndMs: times[times.length - 1], thresholdBase, t0Bars: b.t[0], builtAt: 'test', source: 'synthetic',
    },
    times, rows, bars: { c: b.c, h: b.h, l: b.l },
  }))
}
