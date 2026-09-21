// Builds the Market Setup Analyzer feature store from the Binance bulk archive cached by scripts/audit/download.ts.
//   npx tsx scripts/analyzer/buildStore.ts
// Output: public/analyzer/store.bin (~9 MB).  One observation per 15 minutes; features computed by the SAME function the
// live snapshot uses (src/lib/analyzer/features.ts) from data available at each observation time only.
//
// τ0 (similarity threshold) is calibrated WITHOUT outcomes: on train rows only, τ0 = median over 300 train queries of the
// distance to their 3rd-percentile nearest train row — i.e. "a typical state has about 3 % of the history as analogs".
// No forward return is read anywhere in this script.
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadDataset, TRAIN_END, VAL_END } from '../audit/lib'
import { BAR_MS, MIN_BAR_INDEX } from '../../src/lib/analyzer/config'
import { FEATURE_NAMES, featureVector, prepareSeries, trendFromCandles, type FundingPoint } from '../../src/lib/analyzer/features'
import { decodeStore, encodeStore } from '../../src/lib/analyzer/store'
import { distanceToRow } from '../../src/lib/analyzer/similarity'
import type { Candle } from '../../src/types/scalpSignal'

const ds = loadDataset()
const f5 = ds.fut_5m
const series = prepareSeries({ t: f5.map((k) => k.t), h: f5.map((k) => k.h), l: f5.map((k) => k.l), c: f5.map((k) => k.c), v: f5.map((k) => k.v) })

const oiMap = new Map<number, number>()
for (const p of ds.oi) if (p.oi > 0) oiMap.set(p.t, p.oi)
const funding: FundingPoint[] = ds.funding.map((f) => ({ t: f.t, rate: f.rate * 100 }))

const c4h: Candle[] = ds.spot_4h.map((k) => ({ openTime: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v, closeTime: k.ct }))
const trendByCandle = c4h.map((_, j) => trendFromCandles(c4h.slice(Math.max(0, j - 299), j + 1)))

const times: number[] = []
const rows: Float64Array[] = []
let skipped = 0
let p4 = -1
for (let i = 0; i < series.n; i++) {
  const T = series.t[i] + BAR_MS
  while (p4 + 1 < c4h.length && c4h[p4 + 1].closeTime < T) p4++
  if (T % 900_000 !== 0 || i < MIN_BAR_INDEX || p4 < 0) continue
  const v = featureVector(series, i, { oiAt: (t) => oiMap.get(t), funding, trend: trendByCandle[p4] })
  if (!v) { skipped++; continue }
  times.push(T)
  rows.push(v)
}
console.log(`rows ${rows.length} (skipped for missing inputs: ${skipped}); ${new Date(times[0]).toISOString()} → ${new Date(times[times.length - 1]).toISOString()}`)

const baseMeta = {
  symbol: 'BTCUSDT',
  trainEndMs: TRAIN_END, valEndMs: VAL_END,
  dataStartMs: times[0], dataEndMs: times[times.length - 1],
  thresholdBase: 1,
  builtAt: new Date().toISOString(),
  source: 'data.binance.vision: futures/um 5m klines, metrics (5m OI), fundingRate; spot 4h klines (regime)',
}
const bars = { c: series.c, h: series.h, l: series.l }
// bars[0] open time == meta.t0Bars
const inp = { meta: { ...baseMeta, t0Bars: series.t[0] }, times, rows, bars }
let store = decodeStore(encodeStore(inp))

// ---- outcome-free calibration of tau0 on TRAIN rows ----
const nTrain = store.nTrain
const nq = 300
const per: number[] = []
for (let q = 0; q < nq; q++) {
  const r0 = Math.floor(((q + 0.5) / nq) * nTrain)
  const zq = store.z.subarray(r0 * store.F, (r0 + 1) * store.F)
  const d: number[] = []
  for (let r = 0; r < nTrain; r++) if (r !== r0) d.push(distanceToRow(zq, store.z, r))
  d.sort((a, b) => a - b)
  per.push(d[Math.floor(0.03 * d.length)])
}
per.sort((a, b) => a - b)
const tau0 = Math.round(per[per.length >> 1] * 100) / 100
console.log(`calibrated tau0 = ${tau0} (per-query 3rd-percentile distance: min ${per[0].toFixed(2)} median ${per[per.length >> 1].toFixed(2)} max ${per[per.length - 1].toFixed(2)})`)

const final = encodeStore({ ...inp, meta: { ...inp.meta, thresholdBase: tau0 } })
store = decodeStore(final)
mkdirSync('public/analyzer', { recursive: true })
writeFileSync('public/analyzer/store.bin', final)
console.log(`features: ${FEATURE_NAMES.join(', ')}`)
console.log(`written public/analyzer/store.bin ${(final.byteLength / 1e6).toFixed(2)} MB, version ${store.meta.version}, train rows ${store.nTrain}/${store.n}`)
