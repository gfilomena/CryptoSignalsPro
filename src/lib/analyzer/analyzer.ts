// Historical analog analysis. Pure and deterministic: (store, query, config) → result, always the same.
//
// No look-ahead, by construction:
//  * a historical row's vector was computed from data available at its own time (features.ts);
//  * similarity uses only those vectors;
//  * outcomes are read from bars strictly AFTER the row (pathOutcome starts at bar+1);
//  * for validation, `maxAnalogTimeMs` removes every analog whose 24 h outcome window is not finished before the query.
import { BAR_MS, BIAS_HORIZONS, HORIZONS, MAIN_HORIZONS, RETURN_LEVELS, type AnalyzerConfig } from './config'
import { FEATURES, FEATURE_GROUPS, featureIndex, type FeatureGroup } from './features'
import { pathOutcome } from './outcomes'
import { decluster, binomialTwoSidedP, mean, median, sampleClass, wilson, type SampleClass } from './stats'
import { confirmationLabel, evidenceFromP, sampleComponent, strengthFromComponents, type Confirmation, type StrengthComponents } from './strength'
import { distanceToRow, groupGaps, transformVector } from './similarity'
import { barIndexOfObservation, type AnalyzerStore } from './store'

export interface Prob { k: number; n: number; p: number; lo: number; hi: number }
export interface Baseline { n: number; pPositive: number; meanRet: number }
export type Separation = 'ABOVE' | 'BELOW' | 'NONE' | 'NA'
export type Bias = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'INSUFFICIENT'

export interface HorizonResult {
  horizon: string
  bars: number
  /** analogs (within the threshold) whose outcome is already knowable at this horizon */
  nRaw: number
  /** de-clustered, effectively independent analogs — the N every probability below is computed on */
  nEff: number
  sample: SampleClass
  pPositive: Prob
  pNegative: Prob
  pUp: Record<string, Prob>
  pDown: Record<string, Prob>
  meanRet: number
  medianRet: number
  meanMfe: number
  meanMae: number
  meanMaxDrawdown: number
  medianMinutesToMfe: number
  medianMinutesToMae: number
  baseline: { all: Baseline; sameRegime: Baseline | null; sameMomentum: Baseline | null }
  excessPositive: number
  pValueVsBaseline: number
  separation: Separation
}

export interface WindowResult { days: number | null; nAnalogs: number; bias: Bias; h1: HorizonResult | null; h4: HorizonResult | null }
export interface RobustnessRow { multiplier: number; tau: number; nAnalogs: number; bias: Bias; nEff1h: number; pPositive1h: number; excess1h: number }
export interface GroupMatch { group: FeatureGroup; gap: number; level: 'HIGH' | 'MODERATE' | 'LOW'; currentZ: number }

export interface AnalyzerResult {
  storeVersion: string
  queryTimeMs: number
  tau: number
  windowDays: number | null
  poolFromMs: number
  poolToMs: number
  nCandidates: number
  nAnalogs: number
  distance: { mean: number; min: number; poolMedian: number | null }
  horizons: HorizonResult[]
  bias: Bias
  components: StrengthComponents | null
  strength: number | null
  confirmation: Confirmation
  robustness: { rows: RobustnessRow[]; verdict: 'HIGH' | 'LOW' | 'NA' } | null
  windows: WindowResult[] | null
  age: { recent: number; medium: number; old: number } | null
  groups: GroupMatch[] | null
  regime: { queryTrend: -1 | 0 | 1; analogsSameTrend: number } | null
}

export interface AnalyzeOptions {
  /** analogs must have observation time <= this (validation: query time − 24 h, so outcome windows never overlap the query) */
  maxAnalogTimeMs?: number
  /** recency windows are measured back from this time (default: end of the store) */
  anchorMs?: number
  /** light mode: only the bias horizons, no robustness/windows/contributions (used by the chronological validation) */
  light?: boolean
  /** method-validity component from the shipped out-of-sample validation (null/undefined → 0) */
  oosValidity?: number | null
}

const DAY = 86_400_000

function lowerBound(a: Float64Array, x: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (a[m] < x) lo = m + 1
    else hi = m
  }
  return lo
}

interface Sel { rows: number[]; d: number[] }

const barOf = (store: AnalyzerStore, r: number) => barIndexOfObservation(store, store.times[r])

function baselineFor(store: AnalyzerStore, rows: ArrayLike<number> | null, lo: number, hi: number, H: number, pred: ((r: number) => boolean) | null): Baseline | null {
  const c = store.bars.c
  let n = 0
  let pos = 0
  let sum = 0
  const visit = (r: number) => {
    if (pred && !pred(r)) return
    const bi = barOf(store, r)
    if (bi + H >= store.meta.nBars) return
    const ret = c[bi + H] / c[bi] - 1
    n++
    if (ret > 0) pos++
    sum += ret
  }
  if (rows) for (let q = 0; q < rows.length; q++) visit(rows[q])
  else for (let r = lo; r < hi; r++) visit(r)
  return n ? { n, pPositive: pos / n, meanRet: sum / n } : null
}

function evaluateHorizon(
  store: AnalyzerStore,
  sel: Sel,
  lo: number,
  hi: number,
  hz: { label: string; bars: number },
  cfg: AnalyzerConfig,
  query: { trend: number; ret1h: number },
  extraBaselines: boolean,
  baseCache: Map<string, Baseline | null>,
  windowKey: string,
  rowMinIdx: number,
): HorizonResult {
  const H = hz.bars
  const { c, h, l } = store.bars
  const tIdx = featureIndex('trend_4h')
  const rIdx = featureIndex('ret_1h')

  const times: number[] = []
  const dists: number[] = []
  const rowsWithOutcome: number[] = []
  for (let q = 0; q < sel.rows.length; q++) {
    const r = sel.rows[q]
    if (r < rowMinIdx) continue
    if (barOf(store, r) + H >= store.meta.nBars) continue
    rowsWithOutcome.push(r)
    times.push(store.times[r])
    dists.push(sel.d[q])
  }
  const gapMs = Math.max(H * BAR_MS, cfg.minGapMinutes * 60_000)
  const kept = decluster(times, dists, gapMs)

  const rets: number[] = []
  const mfe: number[] = []
  const mae: number[] = []
  const dd: number[] = []
  const tMfe: number[] = []
  const tMae: number[] = []
  for (const kq of kept) {
    const bi = barOf(store, rowsWithOutcome[kq])
    const o = pathOutcome(c[bi], h, l, c, bi + 1, H)
    if (!o) continue
    rets.push(o.ret)
    mfe.push(o.mfe)
    mae.push(o.mae)
    dd.push(o.maxDrawdown)
    tMfe.push(o.barsToMfe * 5)
    tMae.push(o.barsToMae * 5)
  }
  const n = rets.length
  const prob = (pred: (x: number) => boolean): Prob => {
    let k = 0
    for (const x of rets) if (pred(x)) k++
    const w = wilson(k, n, cfg.z)
    return { k, n, p: w.p, lo: w.lo, hi: w.hi }
  }
  const pUp: Record<string, Prob> = {}
  const pDown: Record<string, Prob> = {}
  for (const lv of RETURN_LEVELS) {
    pUp[`${lv * 100}%`] = prob((x) => x > lv)
    pDown[`${lv * 100}%`] = prob((x) => x < -lv)
  }
  const pPositive = prob((x) => x > 0)
  const pNegative = prob((x) => x < 0)

  const cached = (key: string, compute: () => Baseline | null) => {
    const k = `${windowKey}|${H}|${key}`
    if (!baseCache.has(k)) baseCache.set(k, compute())
    return baseCache.get(k) ?? null
  }
  const all = cached('all', () => baselineFor(store, null, Math.max(lo, rowMinIdx), hi, H, null)) ?? { n: 0, pPositive: NaN, meanRet: NaN }
  let sameRegime: Baseline | null = null
  let sameMomentum: Baseline | null = null
  if (extraBaselines) {
    sameRegime = cached(`reg${query.trend}`, () => baselineFor(store, null, Math.max(lo, rowMinIdx), hi, H, (r) => store.raw[r * store.F + tIdx] === query.trend))
    const up = query.ret1h > 0
    sameMomentum = cached(`mom${up}`, () => baselineFor(store, null, Math.max(lo, rowMinIdx), hi, H, (r) => store.raw[r * store.F + rIdx] > 0 === up))
  }

  const sample = sampleClass(n, cfg)
  let separation: Separation = 'NA'
  if (sample !== 'INSUFFICIENT' && Number.isFinite(all.pPositive)) {
    separation = pPositive.lo > all.pPositive ? 'ABOVE' : pPositive.hi < all.pPositive ? 'BELOW' : 'NONE'
  }
  return {
    horizon: hz.label,
    bars: H,
    nRaw: rowsWithOutcome.length,
    nEff: n,
    sample,
    pPositive,
    pNegative,
    pUp,
    pDown,
    meanRet: mean(rets),
    medianRet: median(rets),
    meanMfe: mean(mfe),
    meanMae: mean(mae),
    meanMaxDrawdown: mean(dd),
    medianMinutesToMfe: median(tMfe),
    medianMinutesToMae: median(tMae),
    baseline: { all, sameRegime, sameMomentum },
    excessPositive: pPositive.p - all.pPositive,
    pValueVsBaseline: Number.isFinite(all.pPositive) ? binomialTwoSidedP(pPositive.k, n, all.pPositive) : 1,
    separation,
  }
}

/** Bias from the bias horizons: ≥2 usable horizons; BULLISH/BEARISH need ≥2 separated in one direction and none in the other. */
export function classifyBias(hs: HorizonResult[]): Bias {
  const usable = hs.filter((x) => BIAS_HORIZONS.includes(x.horizon as (typeof BIAS_HORIZONS)[number]) && x.separation !== 'NA')
  if (usable.length < 2) return 'INSUFFICIENT'
  const above = usable.filter((x) => x.separation === 'ABOVE').length
  const below = usable.filter((x) => x.separation === 'BELOW').length
  if (above >= 2 && below === 0) return 'BULLISH'
  if (below >= 2 && above === 0) return 'BEARISH'
  return 'NEUTRAL'
}

export function analyze(store: AnalyzerStore, query: { t: number; vector: ArrayLike<number> }, cfg: AnalyzerConfig, opts: AnalyzeOptions = {}): AnalyzerResult {
  const F = store.F
  const zq = transformVector(store.scaler, query.vector)
  const anchor = opts.anchorMs ?? store.meta.dataEndMs
  const maxT = opts.maxAnalogTimeMs ?? Infinity
  const lo0 = 0
  const hi = Math.min(store.n, lowerBound(store.times, maxT + 1))
  const tauMax = cfg.thresholdBase * Math.max(...cfg.thresholdMultipliers)
  const tauMain = cfg.thresholdBase
  const trend = query.vector[featureIndex('trend_4h')] as -1 | 0 | 1
  const ret1h = query.vector[featureIndex('ret_1h')]
  const light = !!opts.light

  // ---- candidates within the widest threshold (single pass over the pool) ----
  const rows: number[] = []
  const dAll: number[] = []
  const poolD = light ? null : new Float32Array(hi - lo0)
  for (let r = lo0; r < hi; r++) {
    const d = distanceToRow(zq, store.z, r)
    if (poolD) poolD[r - lo0] = d
    if (d <= tauMax) { rows.push(r); dAll.push(d) }
  }
  const window = (days: number | null) => (days === null ? -Infinity : anchor - days * DAY)
  const rowStart = (days: number | null) => lowerBound(store.times, window(days))

  const selFor = (tau: number, days: number | null): Sel => {
    const w = window(days)
    const out: Sel = { rows: [], d: [] }
    for (let q = 0; q < rows.length; q++) {
      if (dAll[q] <= tau && store.times[rows[q]] >= w) { out.rows.push(rows[q]); out.d.push(dAll[q]) }
    }
    return out
  }

  const baseCache = new Map<string, Baseline | null>()
  const hzList = light ? HORIZONS.filter((x) => (BIAS_HORIZONS as readonly string[]).includes(x.label)) : HORIZONS

  const evalAt = (tau: number, days: number | null, list: typeof HORIZONS, extra: boolean): { sel: Sel; res: HorizonResult[] } => {
    const sel = selFor(tau, days)
    const minIdx = rowStart(days)
    const res = list.map((x) => evaluateHorizon(store, sel, lo0, hi, x, cfg, { trend, ret1h }, extra, baseCache, `w${days}`, minIdx))
    return { sel, res }
  }

  const main = evalAt(tauMain, cfg.windowDays, hzList, !light)
  const bias = classifyBias(main.res)
  const dm = main.sel.d
  const distance = {
    mean: dm.length ? mean(dm) : NaN,
    min: dm.length ? Math.min(...dm) : NaN,
    poolMedian: poolD ? median(poolD) : null,
  }

  let robustness: AnalyzerResult['robustness'] = null
  let windows: WindowResult[] | null = null
  let age: AnalyzerResult['age'] = null
  let groups: GroupMatch[] | null = null
  let regime: AnalyzerResult['regime'] = null
  let components: StrengthComponents | null = null
  let strength: number | null = null

  if (!light) {
    // ---- robustness across similarity thresholds ----
    const biasList = HORIZONS.filter((x) => (BIAS_HORIZONS as readonly string[]).includes(x.label))
    const rrows: RobustnessRow[] = cfg.thresholdMultipliers.map((m) => {
      const { sel, res } = evalAt(cfg.thresholdBase * m, cfg.windowDays, biasList, false)
      const h1 = res.find((x) => x.horizon === '1h')
      return { multiplier: m, tau: cfg.thresholdBase * m, nAnalogs: sel.rows.length, bias: classifyBias(res), nEff1h: h1?.nEff ?? 0, pPositive1h: h1?.pPositive.p ?? NaN, excess1h: h1?.excessPositive ?? NaN }
    })
    const biases = new Set(rrows.map((x) => x.bias))
    robustness = { rows: rrows, verdict: bias === 'INSUFFICIENT' ? 'NA' : biases.size === 1 ? 'HIGH' : 'LOW' }

    // ---- recency windows (each with its own baseline) ----
    windows = [30, 90, 180, 365, 730, null].map((days) => {
      const { sel, res } = evalAt(tauMain, days, biasList, false)
      return { days, nAnalogs: sel.rows.length, bias: classifyBias(res), h1: res.find((x) => x.horizon === '1h') ?? null, h4: res.find((x) => x.horizon === '4h') ?? null }
    })
    const ages = main.sel.rows.map((r) => (anchor - store.times[r]) / DAY)
    age = { recent: ages.filter((a) => a <= 90).length, medium: ages.filter((a) => a > 90 && a <= 365).length, old: ages.filter((a) => a > 365).length }

    // ---- which groups make the analogs similar ----
    const acc = {} as Record<FeatureGroup, number>
    for (const g of FEATURE_GROUPS) acc[g] = 0
    for (const r of main.sel.rows) {
      const gp = groupGaps(zq, store.z, r)
      for (const g of FEATURE_GROUPS) acc[g] += gp[g]
    }
    const nA = Math.max(1, main.sel.rows.length)
    groups = FEATURE_GROUPS.map((g) => {
      const gap = Math.sqrt(acc[g] / nA)
      const idxs = FEATURES.map((f, i) => (f.group === g ? i : -1)).filter((i) => i >= 0)
      const currentZ = mean(idxs.map((i) => zq[i]))
      return { group: g, gap, level: gap <= cfg.matchBins.high ? 'HIGH' : gap <= cfg.matchBins.moderate ? 'MODERATE' : 'LOW', currentZ }
    })
    const tIdx = featureIndex('trend_4h')
    regime = { queryTrend: trend, analogsSameTrend: main.sel.rows.filter((r) => store.raw[r * F + tIdx] === trend).length }

    // ---- setup strength ----
    if (bias !== 'INSUFFICIENT') {
      const bh = main.res.filter((x) => (BIAS_HORIZONS as readonly string[]).includes(x.horizon))
      const usable = bh.filter((x) => x.separation !== 'NA')
      const dir = bias === 'BULLISH' ? 1 : bias === 'BEARISH' ? -1 : Math.sign(mean(usable.map((x) => x.excessPositive))) || 1
      const disp = main.res.filter((x) => (MAIN_HORIZONS as readonly string[]).includes(x.horizon) && x.sample !== 'INSUFFICIENT')
      components = {
        n: sampleComponent(median(usable.map((x) => x.nEff)), cfg),
        sim: distance.poolMedian ? Math.max(0, 1 - distance.mean / distance.poolMedian) : 0,
        sep: mean(usable.map((x) => evidenceFromP(x.pValueVsBaseline))),
        cons: disp.length ? disp.filter((x) => Math.sign(x.excessPositive) === dir).length / disp.length : 0,
        rob: rrows.filter((x) => x.bias === bias).length / rrows.length,
        oos: opts.oosValidity ?? 0,
      }
      strength = strengthFromComponents(components)
    }
  }

  return {
    storeVersion: store.meta.version,
    queryTimeMs: query.t,
    tau: tauMain,
    windowDays: cfg.windowDays,
    poolFromMs: hi > lo0 ? store.times[lo0] : NaN,
    poolToMs: hi > lo0 ? store.times[hi - 1] : NaN,
    nCandidates: hi - lo0,
    nAnalogs: main.sel.rows.length,
    distance,
    horizons: main.res,
    bias,
    components,
    strength,
    // only a directional bias can be "confirmed"; NEUTRAL / INSUFFICIENT never are (spec §21: "does not support a clear directional setup")
    confirmation: bias === 'BULLISH' || bias === 'BEARISH' ? confirmationLabel(strength, cfg) : 'NONE',
    robustness,
    windows,
    age,
    groups,
    regime,
  }
}
