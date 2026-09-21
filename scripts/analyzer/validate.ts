// Chronological walk-forward validation of the analyzer itself (spec §18, §19, §24).
//   npx tsx scripts/analyzer/validate.ts
// For every query time T (every 6 h) in each split (train / validation / OOS = 60/20/20 by time), the analyzer is run as it
// would have been at T: candidate analogs are ONLY rows whose 24 h outcome window ended before T (T_analog + 24 h <= T).
// Its bias and historical frequencies are then compared with what really happened after T. Nothing is tuned here: τ0 was
// calibrated outcome-free and every other constant is documented in config.ts. The OOS split is reported as the headline.
import { readFileSync, writeFileSync } from 'node:fs'
import { BIAS_HORIZONS, DEFAULT_CONFIG, HORIZONS } from '../../src/lib/analyzer/config'
import { analyze, type Bias } from '../../src/lib/analyzer/analyzer'
import { decodeStore, barIndexOfObservation } from '../../src/lib/analyzer/store'
import { bootstrapMeanCI, binomialUpperP, mean, wilson } from '../../src/lib/analyzer/stats'
import { FEATURES } from '../../src/lib/analyzer/features'
import { evidenceFromP } from '../../src/lib/analyzer/strength'

const store = decodeStore(readFileSync('public/analyzer/store.bin'))
const cfg = { ...DEFAULT_CONFIG, thresholdBase: store.meta.thresholdBase }
const DAY = 86_400_000
const F = store.F

interface Rec { bias: Bias; ret: Record<string, number>; pHat: Record<string, number>; p0: Record<string, number> }
const splits: Record<string, Rec[]> = { train: [], val: [], oos: [] }
const nQ: Record<string, number> = { train: 0, val: 0, oos: 0 }

const t0 = Date.now()
for (let r = 0; r < store.n; r++) {
  const T = store.times[r]
  if (T % (6 * 3_600_000) !== 0) continue
  if (T - store.meta.dataStartMs < 30 * DAY) continue // need at least a month of history to be a fair query
  const split = T < store.meta.trainEndMs ? 'train' : T < store.meta.valEndMs ? 'val' : 'oos'
  nQ[split]++
  const res = analyze(store, { t: T, vector: Array.from(store.raw.subarray(r * F, (r + 1) * F)) }, cfg, {
    light: true,
    maxAnalogTimeMs: T - DAY, // analog outcome windows (<= 24 h) must be over before the query
    anchorMs: T,
  })
  if (res.bias === 'INSUFFICIENT') { splits[split].push({ bias: 'INSUFFICIENT', ret: {}, pHat: {}, p0: {} }); continue }
  const bi = barIndexOfObservation(store, T)
  const rec: Rec = { bias: res.bias, ret: {}, pHat: {}, p0: {} }
  for (const hz of HORIZONS.filter((h) => (BIAS_HORIZONS as readonly string[]).includes(h.label))) {
    if (bi + hz.bars >= store.meta.nBars) continue
    rec.ret[hz.label] = store.bars.c[bi + hz.bars] / store.bars.c[bi] - 1
    const hr = res.horizons.find((x) => x.horizon === hz.label)!
    rec.pHat[hz.label] = hr.pPositive.p
    rec.p0[hz.label] = hr.baseline.all.pPositive
  }
  splits[split].push(rec)
}
console.log(`walk-forward done in ${((Date.now() - t0) / 1000).toFixed(0)} s; queries ${JSON.stringify(nQ)}`)

const out: Record<string, unknown> = {}
for (const [name, recs] of Object.entries(splits)) {
  const usable = recs.filter((x) => x.bias !== 'INSUFFICIENT')
  const per: Record<string, unknown> = {}
  for (const h of BIAS_HORIZONS) {
    const withRet = usable.filter((x) => h in x.ret)
    const allRet = withRet.map((x) => x.ret[h])
    const pUncond = allRet.filter((x) => x > 0).length / (allRet.length || 1)
    const dir = withRet.filter((x) => x.bias === 'BULLISH' || x.bias === 'BEARISH')
    const hits = dir.filter((x) => (x.bias === 'BULLISH' ? x.ret[h] > 0 : x.ret[h] < 0)).length
    const bestConst = Math.max(pUncond, 1 - pUncond)
    const w = wilson(hits, dir.length)
    const bull = withRet.filter((x) => x.bias === 'BULLISH')
    const bear = withRet.filter((x) => x.bias === 'BEARISH')
    const neut = withRet.filter((x) => x.bias === 'NEUTRAL')
    const posRate = (xs: Rec[]) => (xs.length ? xs.filter((x) => x.ret[h] > 0).length / xs.length : null)
    const brierP = mean(withRet.map((x) => (x.pHat[h] - (x.ret[h] > 0 ? 1 : 0)) ** 2))
    const brier0 = mean(withRet.map((x) => (x.p0[h] - (x.ret[h] > 0 ? 1 : 0)) ** 2))
    const spreadCI = bull.length >= 10 && bear.length >= 10 ? bootstrapMeanCI(bull.map((x) => x.ret[h]).concat(bear.map((x) => -x.ret[h]))) : null
    per[h] = {
      nUsable: withRet.length, nBullish: bull.length, nBearish: bear.length, nNeutral: neut.length,
      realisedPositiveAfter: { bullish: posRate(bull), bearish: posRate(bear), neutral: posRate(neut), unconditional: pUncond },
      directional: { n: dir.length, hits, accuracy: dir.length ? hits / dir.length : null, ci: dir.length ? [w.lo, w.hi] : null, bestConstantGuess: bestConst, pOneSided: dir.length ? binomialUpperP(hits, dir.length, bestConst) : null },
      meanDirectionalReturn: dir.length ? mean(dir.map((x) => (x.bias === 'BULLISH' ? x.ret[h] : -x.ret[h]))) : null,
      meanDirectionalReturnCI: spreadCI,
      brier: { analyzer: brierP, baseline: brier0, skill: brier0 > 0 ? 1 - brierP / brier0 : null },
    }
  }
  out[name] = { queries: nQ[name], nonInsufficient: usable.length, coverage: usable.length / Math.max(1, nQ[name]), horizons: per }
}

// method-validity component for Setup Strength: confidence that OOS directional accuracy beat the best constant guess (1h)
const oos1h = ((out.oos as { horizons: Record<string, { directional: { n: number; pOneSided: number | null } }> }).horizons['1h']).directional
const oosValidity = oos1h.n >= 30 && oos1h.pOneSided !== null ? evidenceFromP(oos1h.pOneSided) : 0
const payload = {
  generatedAt: new Date().toISOString(),
  storeVersion: store.meta.version,
  tau0: store.meta.thresholdBase,
  queryEvery: '6h',
  poolRule: 'analogs only if T_analog + 24h <= T_query',
  splits: { train: [store.meta.dataStartMs, store.meta.trainEndMs], val: [store.meta.trainEndMs, store.meta.valEndMs], oos: [store.meta.valEndMs, store.meta.dataEndMs] },
  featureCount: FEATURES.length,
  oosValidity,
  oosValidityRule: 'S_oos = min(1, -log10(p)/3), p = one-sided binomial test that OOS 1h directional accuracy of BULLISH/BEARISH calls beat the best constant guess; 0 if fewer than 30 directional calls',
  results: out,
}
writeFileSync('public/analyzer/validation.json', JSON.stringify(payload, null, 1))
console.log(JSON.stringify({ oosValidity, oos: out.oos }, null, 1).slice(0, 3800))
