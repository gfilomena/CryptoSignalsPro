// Shared, deterministic statistics + evaluation helpers for the signal-engine audit.
// Everything here is pure (no I/O besides loadDataset) and seeded, so the same dataset + config
// always reproduces byte-identical results.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Kline } from './download'

export const CACHE = join(process.cwd(), '.audit-cache')

export interface Dataset {
  spot_15m: Kline[]
  spot_1h: Kline[]
  spot_4h: Kline[]
  fut_5m: Kline[]
  fut_15m: Kline[]
  fut_1h: Kline[]
  fut_4h: Kline[]
  funding: { t: number; intervalH: number; rate: number }[]
  oi: { t: number; oi: number; oiUsd: number }[]
}

export function loadDataset(): Dataset {
  return JSON.parse(readFileSync(join(CACHE, 'dataset.json'), 'utf8')) as Dataset
}

// ---- chronological split (60/20/20) ------------------------------------------------------------
// Never shuffled. Boundaries are fixed from the dataset span so they cannot be tuned.
export const DATA_START = Date.parse('2023-09-01T00:00:00Z')
export const DATA_END = Date.parse('2026-09-01T00:00:00Z')
export const TRAIN_END = DATA_START + 0.6 * (DATA_END - DATA_START)
export const VAL_END = DATA_START + 0.8 * (DATA_END - DATA_START)
export type Split = 'train' | 'val' | 'oos'
export const splitOf = (t: number): Split => (t < TRAIN_END ? 'train' : t < VAL_END ? 'val' : 'oos')

// ---- costs -------------------------------------------------------------------------------------
// Same numbers as DEFAULT_STRATEGY_CONFIG.tradingCosts: 2 x fee(0.04%) + spread(0.02%) + slippage(0.02%).
export const ROUND_TRIP_COST = (2 * 0.04 + 0.02 + 0.02) / 100

// ---- deterministic RNG + stats -----------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
export function median(xs: number[]): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]
}

/** 95% percentile-bootstrap CI of the mean (seeded => reproducible). */
export function bootstrapMeanCI(xs: number[], seed = 12345, B = 2000): [number, number] {
  if (xs.length < 2) return [NaN, NaN]
  const rnd = mulberry32(seed)
  const n = xs.length
  const means: number[] = new Array(B)
  for (let b = 0; b < B; b++) {
    let s = 0
    for (let i = 0; i < n; i++) s += xs[Math.floor(rnd() * n)]
    means[b] = s / n
  }
  means.sort((a, b) => a - b)
  return [means[Math.floor(0.025 * B)], means[Math.floor(0.975 * B)]]
}

// ---- forward-return evaluation ------------------------------------------------------------------
export interface Bar { t: number; o: number; h: number; l: number; c: number; ct: number }

export interface Horizon { label: string; bars: number }

export interface ForwardResult {
  /** direction-adjusted gross return, from the signal-bar close (fraction, e.g. 0.004 = 0.4%) */
  ret: number
  /** same, but entering at the NEXT bar's open (1-bar execution delay) */
  retDelayed: number
  /** max favourable / adverse excursion within the horizon, direction-adjusted, as fractions (mae <= 0) */
  mfe: number
  mae: number
}

/**
 * Forward outcome for an event observed at the CLOSE of bar `i` (information set: bars <= i only).
 * `dir` = +1 (long/bullish hypothesis) or -1 (short/bearish). Returns null if the horizon runs past the data.
 */
export function forward(bars: Bar[], i: number, dir: 1 | -1, H: number): ForwardResult | null {
  if (i + H >= bars.length) return null
  const p0 = bars[i].c
  const pN = bars[i + H].c
  const entryDelayed = bars[i + 1].o
  let hi = -Infinity
  let lo = Infinity
  for (let j = i + 1; j <= i + H; j++) {
    if (bars[j].h > hi) hi = bars[j].h
    if (bars[j].l < lo) lo = bars[j].l
  }
  const up = hi / p0 - 1
  const down = lo / p0 - 1
  return {
    ret: dir * (pN / p0 - 1),
    retDelayed: dir * (pN / entryDelayed - 1),
    mfe: dir > 0 ? up : -down,
    mae: dir > 0 ? down : -up,
  }
}

export interface FirstPassage { target: number; adverse: number; neither: number }

/** P(price moves X in favour before X against, within H bars). Same-bar double touch counts as adverse (conservative). */
export function firstPassage(bars: Bar[], i: number, dir: 1 | -1, H: number, X: number): 'target' | 'adverse' | 'neither' | null {
  if (i + H >= bars.length) return null
  const p0 = bars[i].c
  const up = p0 * (1 + X)
  const dn = p0 * (1 - X)
  for (let j = i + 1; j <= i + H; j++) {
    const hitUp = bars[j].h >= up
    const hitDn = bars[j].l <= dn
    const tgt = dir > 0 ? hitUp : hitDn
    const adv = dir > 0 ? hitDn : hitUp
    if (adv) return 'adverse'
    if (tgt) return 'target'
  }
  return 'neither'
}

// ---- event summaries ----------------------------------------------------------------------------
export interface SignalEvent { i: number; dir: 1 | -1; t: number }

export interface HorizonStats {
  horizon: string
  n: number
  nIndep: number
  meanGross: number
  medianGross: number
  meanNet: number
  meanNetDelayed: number
  ciNet: [number, number]
  pctPositiveNet: number
  pctPositiveGross: number
  baselineMeanGross: number
  excessGross: number
  excessNet: number
  ciExcessNet: [number, number]
  meanMfe: number
  meanMae: number
  best: number
  worst: number
}

/** Unconditional per-direction baseline: mean direction-adjusted return over EVERY bar in the range.
 * Memoised per (bars, dir, H, range) — it is identical for every event of a given direction. */
const baselineCache = new WeakMap<Bar[], Map<string, number>>()
export function baseline(bars: Bar[], dir: 1 | -1, H: number, from: number, to: number): number {
  let m = baselineCache.get(bars)
  if (!m) { m = new Map(); baselineCache.set(bars, m) }
  const key = `${dir}|${H}|${from}|${to}`
  const hit = m.get(key)
  if (hit !== undefined) return hit
  let s = 0
  let n = 0
  for (let i = 0; i + H < bars.length; i++) {
    if (bars[i].ct < from || bars[i].ct >= to) continue
    s += dir * (bars[i + H].c / bars[i].c - 1)
    n++
  }
  const v = n ? s / n : NaN
  m.set(key, v)
  return v
}

/** Greedy de-clustering: keep an event only if it is >= H bars after the previous kept one (non-overlapping outcomes). */
export function independentCount(events: SignalEvent[], H: number): number {
  let last = -Infinity
  let n = 0
  for (const e of [...events].sort((a, b) => a.i - b.i)) {
    if (e.i - last >= H) { n++; last = e.i }
  }
  return n
}

export function summarize(bars: Bar[], events: SignalEvent[], horizons: Horizon[], from: number, to: number, cost = ROUND_TRIP_COST): HorizonStats[] {
  const evs = events.filter((e) => e.t >= from && e.t < to)
  return horizons.map((h) => {
    const rows = evs.map((e) => ({ e, f: forward(bars, e.i, e.dir, h.bars) })).filter((r): r is { e: SignalEvent; f: ForwardResult } => r.f !== null)
    const gross = rows.map((r) => r.f.ret)
    const net = gross.map((x) => x - cost)
    const base = rows.map((r) => baseline(bars, r.e.dir, h.bars, from, to))
    const baseMean = mean(base)
    const excessNetSeries = rows.map((r, k) => net[k] - base[k])
    return {
      horizon: h.label,
      n: rows.length,
      nIndep: independentCount(rows.map((r) => r.e), h.bars),
      meanGross: mean(gross),
      medianGross: median(gross),
      meanNet: mean(net),
      meanNetDelayed: mean(rows.map((r) => r.f.retDelayed - cost)),
      ciNet: bootstrapMeanCI(net),
      pctPositiveNet: rows.length ? net.filter((x) => x > 0).length / rows.length : NaN,
      pctPositiveGross: rows.length ? gross.filter((x) => x > 0).length / rows.length : NaN,
      baselineMeanGross: baseMean,
      excessGross: mean(gross) - baseMean,
      excessNet: mean(excessNetSeries),
      ciExcessNet: bootstrapMeanCI(excessNetSeries),
      meanMfe: mean(rows.map((r) => r.f.mfe)),
      meanMae: mean(rows.map((r) => r.f.mae)),
      best: gross.length ? Math.max(...gross) : NaN,
      worst: gross.length ? Math.min(...gross) : NaN,
    }
  })
}

export function firstPassageTable(bars: Bar[], events: SignalEvent[], H: number, thresholds: number[], from: number, to: number) {
  const evs = events.filter((e) => e.t >= from && e.t < to)
  return thresholds.map((X) => {
    const c = { target: 0, adverse: 0, neither: 0 }
    for (const e of evs) {
      const r = firstPassage(bars, e.i, e.dir, H, X)
      if (r) c[r]++
    }
    const n = c.target + c.adverse + c.neither
    return { X, n, pTarget: n ? c.target / n : NaN, pAdverse: n ? c.adverse / n : NaN, pNeither: n ? c.neither / n : NaN }
  })
}

// ---- formatting ---------------------------------------------------------------------------------
export const pct = (x: number, d = 3): string => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a')
export const num = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')

export function toBars(ks: Kline[]): Bar[] {
  return ks.map((k) => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, ct: k.ct }))
}

// ---- volatility regime (thresholds fitted on TRAIN only, applied as-of) ------------------------
/** Std-dev of the last `n` 15m log-returns ending at bar i (uses bars <= i only). */
export function realizedVol(bars: Bar[], i: number, n = 96): number {
  if (i < n) return NaN
  const r: number[] = []
  for (let j = i - n + 1; j <= i; j++) r.push(Math.log(bars[j].c / bars[j - 1].c))
  return stdev(r)
}
