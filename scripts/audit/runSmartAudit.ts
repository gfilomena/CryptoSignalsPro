// Smart Alerts audit: replays the real presets over 36 months of BTCUSDT-perp data on 5-minute steps and
// evaluates every fired alert against forward price paths. OOS is WITHHELD unless --oos is passed.
//   npx tsx scripts/audit/runSmartAudit.ts [--oos]
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  Horizon, ROUND_TRIP_COST, TRAIN_END, VAL_END, DATA_START, DATA_END, firstPassageTable, loadDataset, mean, median, num, pct, quantile,
  realizedVol, summarize, toBars, type SignalEvent,
} from './lib'
import { buildSnapshotSeries, runSmartAlert, type SmartEvent } from './smartReplay'
import { regimeSeries } from './scalpReplay'
import { PRESET_DEFINITIONS, type PresetId } from '../../src/lib/smartAlerts/presets'

const INCLUDE_OOS = process.argv.includes('--oos')
const ds = loadDataset()
const bars = toBars(ds.fut_5m)
const H: Horizon[] = [
  { label: '5m', bars: 1 }, { label: '15m', bars: 3 }, { label: '30m', bars: 6 }, { label: '1h', bars: 12 },
  { label: '4h', bars: 48 }, { label: '12h', bars: 144 }, { label: '24h', bars: 288 },
]
const RANGES: Record<string, [number, number]> = {
  train: [DATA_START, TRAIN_END], val: [TRAIN_END, VAL_END], 'train+val': [DATA_START, VAL_END],
  ...(INCLUDE_OOS ? { oos: [VAL_END, DATA_END] as [number, number] } : {}),
}
const decisionRange: [number, number] = INCLUDE_OOS ? [DATA_START, DATA_END] : [DATA_START, VAL_END]
const md: string[] = []
const out: Record<string, unknown> = { includeOos: INCLUDE_OOS }
const log = (s = '') => { console.log(s); md.push(s) }

// Directional hypothesis per preset = the bias its own push notification claims (notificationCopy.directionLabel).
const HYP: Record<string, 1 | -1> = { reversal_watch: 1, strong_momentum: 1, overheated_market: -1 }
const LIVE: PresetId[] = ['reversal_watch', 'strong_momentum', 'overheated_market']

const t0 = Date.now()
const series = buildSnapshotSeries(ds)
log(`# Smart Alerts replay — scripts/audit/runSmartAudit.ts (OOS ${INCLUDE_OOS ? 'INCLUDED' : 'WITHHELD'})`)
log(`Snapshot series built: ${series.t.length} five-minute steps in ${Date.now() - t0} ms; first ${new Date(series.t[0]).toISOString()} last ${new Date(series.t[series.t.length - 1]).toISOString()}`)
const nullShare = (f: (s: (typeof series.snapshots)[number]) => number | null | undefined) => series.snapshots.filter((s) => f(s) == null).length / series.snapshots.length
log(`Unavailable-data share per metric: OI 15m ${pct(nullShare((s) => s.openInterestChangePct['15m']), 2)}, OI 1h ${pct(nullShare((s) => s.openInterestChangePct['1h']), 2)}, volume15m ${pct(nullShare((s) => s.volumeChangePct['15m']), 2)}`)

const toSig = (evs: SmartEvent[], dir: 1 | -1): SignalEvent[] => evs.filter((e) => e.kind === 'fired').map((e) => ({ i: e.i, dir, t: e.t }))
const days = (DATA_END - DATA_START) / 86_400_000

// ---- 1. headline per preset (confirmation = 1 step, the live-equivalent of 2 one-minute cycles on data that refreshes every 5-15 min) ----
const perPreset: Record<string, unknown> = {}
for (const id of LIVE) {
  const events = runSmartAlert(series, { presetId: id, confirmationCycles: 1 })
  const fired = events.filter((e) => e.kind === 'fired')
  const inval = events.filter((e) => e.kind === 'invalidated')
  const orphan = inval.filter((e) => !e.streakHadFired)
  log(`\n## ${id}  (hypothesis: ${HYP[id] > 0 ? 'bullish' : 'bearish'} bias)`)
  log(`fired ${fired.length} (${(fired.length / days).toFixed(3)}/day) | invalidation pushes ${inval.length}, of which for a streak that NEVER notified the user: ${orphan.length}`)
  const sig = toSig(events, HYP[id])
  const rows: Record<string, unknown> = {}
  for (const [name, [from, to]] of Object.entries(RANGES)) {
    const st = summarize(bars, sig, H, from, to)
    rows[name] = st
    log(`\n### ${id} — ${name}`)
    log('| horizon | n | n_indep | mean gross | median gross | mean net | mean net (delayed) | 95% CI net | %>0 net | baseline | excess net | 95% CI excess | MFE | MAE |')
    log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for (const s of st) log(`| ${s.horizon} | ${s.n} | ${s.nIndep} | ${pct(s.meanGross)} | ${pct(s.medianGross)} | ${pct(s.meanNet)} | ${pct(s.meanNetDelayed)} | [${pct(s.ciNet[0])}, ${pct(s.ciNet[1])}] | ${pct(s.pctPositiveNet, 1)} | ${pct(s.baselineMeanGross)} | ${pct(s.excessNet)} | [${pct(s.ciExcessNet[0])}, ${pct(s.ciExcessNet[1])}] | ${pct(s.meanMfe)} | ${pct(s.meanMae)} |`)
  }
  const fpRange = INCLUDE_OOS ? RANGES.oos : RANGES['train+val']
  const fp = [48, 288].map((h) => ({ h, rows: firstPassageTable(bars, sig, h, [0.0025, 0.005, 0.01, 0.02], fpRange[0], fpRange[1]) }))
  log(`\n### ${id} — first passage (${INCLUDE_OOS ? 'oos' : 'train+val'})`)
  log('| horizon | X | n | P(target first) | P(adverse first) | P(neither) |')
  log('|---|---|---|---|---|---|')
  for (const { h, rows: r } of fp) for (const x of r) log(`| ${h === 48 ? '4h' : '24h'} | ${pct(x.X, 2)} | ${x.n} | ${pct(x.pTarget, 1)} | ${pct(x.pAdverse, 1)} | ${pct(x.pNeither, 1)} |`)
  perPreset[id] = { fired: fired.length, perDay: fired.length / days, invalidations: inval.length, orphanInvalidations: orphan.length, stats: rows, firstPassage: fp }
}
out.presets = perPreset

// ---- 2. the two liquidation presets: can they fire at all? ----
for (const id of ['long_squeeze_watch', 'short_squeeze_watch'] as PresetId[]) {
  const ev = runSmartAlert(series, { presetId: id, confirmationCycles: 1 })
  log(`\n## ${id}: fired ${ev.filter((e) => e.kind === 'fired').length} times over ${series.t.length} steps (requires liquidation metrics, which marketData.ts always reports as null)`)
  out[id] = { fired: ev.filter((e) => e.kind === 'fired').length }
}

// ---- 3. ablation: every non-empty subset of conditions (decision range) ----
log('\n## Condition ablation (train+val; confirmation=1; excess net vs baseline at 1h / 4h; is each extra condition adding information?)')
log('| preset | conditions kept | n fired | n_indep(4h) | 1h mean gross | 1h excess net | 4h mean gross | 4h excess net | 4h 95% CI excess |')
log('|---|---|---|---|---|---|---|---|---|')
const ablation: unknown[] = []
for (const id of LIVE) {
  const conds = PRESET_DEFINITIONS.find((p) => p.id === id)!.conditions
  for (let mask = 1; mask < 1 << conds.length; mask++) {
    const sub = conds.filter((_, k) => mask & (1 << k))
    const ev = runSmartAlert(series, { presetId: id, confirmationCycles: 1, conditions: sub })
    const st = summarize(bars, toSig(ev, HYP[id]), H, decisionRange[0], decisionRange[1])
    const s1 = st.find((s) => s.horizon === '1h')!
    const s4 = st.find((s) => s.horizon === '4h')!
    const label = sub.map((c) => `${c.metric}${c.timeframe ? '.' + c.timeframe : ''}${c.operator}${c.threshold}`).join(' AND ')
    ablation.push({ id, label, n: s1.n, s1, s4 })
    log(`| ${id} | ${label} | ${s1.n} | ${s4.nIndep} | ${pct(s1.meanGross)} | ${pct(s1.excessNet)} | ${pct(s4.meanGross)} | ${pct(s4.excessNet)} | [${pct(s4.ciExcessNet[0])}, ${pct(s4.ciExcessNet[1])}] |`)
  }
}
out.ablation = ablation

// ---- 4. threshold sensitivity ±10% (one condition at a time, nonzero thresholds only) ----
log('\n## Threshold sensitivity (±10%, one condition at a time; train+val; confirmation=1)')
log('| preset | changed condition | new threshold | n fired | 1h excess net | 4h excess net | 4h mean gross |')
log('|---|---|---|---|---|---|---|')
const sens: unknown[] = []
for (const id of LIVE) {
  const conds = PRESET_DEFINITIONS.find((p) => p.id === id)!.conditions
  const variants: { name: string; conds: typeof conds }[] = [{ name: 'default', conds }]
  conds.forEach((c, k) => {
    if (c.threshold === 0) return
    for (const m of [0.9, 1.1]) variants.push({ name: `${c.metric}${c.timeframe ? '.' + c.timeframe : ''} x${m}`, conds: conds.map((x, j) => (j === k ? { ...x, threshold: x.threshold * m } : x)) })
  })
  for (const v of variants) {
    const ev = runSmartAlert(series, { presetId: id, confirmationCycles: 1, conditions: v.conds })
    const st = summarize(bars, toSig(ev, HYP[id]), H, decisionRange[0], decisionRange[1])
    const s1 = st.find((s) => s.horizon === '1h')!
    const s4 = st.find((s) => s.horizon === '4h')!
    sens.push({ id, variant: v.name, n: s1.n, e1: s1.excessNet, e4: s4.excessNet })
    log(`| ${id} | ${v.name} | ${v.name === 'default' ? '-' : v.conds.map((c) => c.threshold).join('/')} | ${s1.n} | ${pct(s1.excessNet)} | ${pct(s4.excessNet)} | ${pct(s4.meanGross)} |`)
  }
}
out.sensitivity = sens

// ---- 5. confirmation cycles variant ----
log('\n## Confirmation variant: 1 step vs 2 consecutive 5-min steps (train+val)')
log('| preset | steps | n fired | 4h excess net |')
log('|---|---|---|---|')
for (const id of LIVE) for (const c of [1, 2]) {
  const ev = runSmartAlert(series, { presetId: id, confirmationCycles: c })
  const s4 = summarize(bars, toSig(ev, HYP[id]), H, decisionRange[0], decisionRange[1]).find((s) => s.horizon === '4h')!
  log(`| ${id} | ${c} | ${s4.n} | ${pct(s4.excessNet)} |`)
}

// ---- 6. regime slicing (train+val decision range) ----
const spot15 = ds.spot_15m
const sBars = toBars(spot15)
const reg = regimeSeries(spot15, ds.spot_4h)
const volTrain = sBars.map((_, i) => (sBars[i].ct < TRAIN_END ? realizedVol(sBars, i) : NaN)).filter(Number.isFinite)
const v1 = quantile(volTrain, 1 / 3)
const v2 = quantile(volTrain, 2 / 3)
const idx15 = (T: number) => Math.max(0, Math.floor((T - spot15[0].t) / 900_000) - 1)
log('\n## Regime slicing (decision range; 4h excess net; trend regime from 4h EMA+structure, vol terciles fitted on TRAIN only)')
log('| preset | slice | n fired | 4h mean gross | 4h excess net |')
log('|---|---|---|---|---|')
const regOut: unknown[] = []
for (const id of LIVE) {
  const ev = toSig(runSmartAlert(series, { presetId: id, confirmationCycles: 1 }), HYP[id])
  const slices: Record<string, (e: SignalEvent) => boolean> = {
    'trend: bullish': (e) => reg[idx15(e.t)] === 'bullish', 'trend: bearish': (e) => reg[idx15(e.t)] === 'bearish', 'trend: neutral/range': (e) => reg[idx15(e.t)] === 'neutral',
    'vol: low': (e) => realizedVol(sBars, idx15(e.t)) < v1, 'vol: mid': (e) => { const v = realizedVol(sBars, idx15(e.t)); return v >= v1 && v < v2 }, 'vol: high': (e) => realizedVol(sBars, idx15(e.t)) >= v2,
  }
  for (const [name, f] of Object.entries(slices)) {
    const s = summarize(bars, ev.filter(f), H, decisionRange[0], decisionRange[1]).find((x) => x.horizon === '4h')!
    regOut.push({ id, name, n: s.n, gross: s.meanGross, excess: s.excessNet })
    log(`| ${id} | ${name} | ${s.n} | ${pct(s.meanGross)} | ${pct(s.excessNet)} |`)
  }
}
out.regimes = regOut

// ---- 7. descriptive price x OI quadrants (NOT an alert): what actually follows each combination? ----
log('\n## Price(1h) x OI(1h) quadrants — raw forward returns, NOT direction-adjusted (decision range)')
log('dead-band: |price 1h| > 0.3% and |OI 1h| > 0.3%')
log('| quadrant | n steps | fwd 1h mean | fwd 1h %up | fwd 4h mean | fwd 4h %up | fwd 24h mean | fwd 24h %up |')
log('|---|---|---|---|---|---|---|---|')
const quad: Record<string, number[]> = { 'price up + OI up': [], 'price up + OI down': [], 'price down + OI up': [], 'price down + OI down': [], 'all steps (baseline)': [] }
for (let s = 0; s < series.t.length; s++) {
  const T = series.t[s]
  if (T < decisionRange[0] || T >= decisionRange[1]) continue
  const p = series.ret1h[s]
  const o = series.oi1hChange[s]
  quad['all steps (baseline)'].push(s)
  if (!Number.isFinite(o)) continue
  if (p > 0.3 && o > 0.3) quad['price up + OI up'].push(s)
  else if (p > 0.3 && o < -0.3) quad['price up + OI down'].push(s)
  else if (p < -0.3 && o > 0.3) quad['price down + OI up'].push(s)
  else if (p < -0.3 && o < -0.3) quad['price down + OI down'].push(s)
}
const quadOut: unknown[] = []
for (const [name, steps] of Object.entries(quad)) {
  const fwd = (h: number) => steps.map((s) => { const i = series.barIndex[s]; return i + h < bars.length ? bars[i + h].c / bars[i].c - 1 : NaN }).filter(Number.isFinite)
  const r = [12, 48, 288].map((h) => fwd(h))
  quadOut.push({ name, n: steps.length, mean1h: mean(r[0]), mean4h: mean(r[1]), mean24h: mean(r[2]) })
  log(`| ${name} | ${steps.length} | ${pct(mean(r[0]))} | ${pct(r[0].filter((x) => x > 0).length / r[0].length, 1)} | ${pct(mean(r[1]))} | ${pct(r[1].filter((x) => x > 0).length / r[1].length, 1)} | ${pct(mean(r[2]))} | ${pct(r[2].filter((x) => x > 0).length / r[2].length, 1)} |`)
}
out.quadrants = quadOut

// ---- 8. funding buckets: raw forward returns ----
log('\n## Funding-rate buckets (last settled rate) — raw forward returns (decision range)')
log('| funding bucket | share of steps | fwd 4h mean | fwd 4h %up | fwd 24h mean | fwd 24h %up |')
log('|---|---|---|---|---|---|')
const fb: [string, (f: number) => boolean][] = [
  ['< 0', (f) => f < 0], ['0 to <0.005%', (f) => f >= 0 && f < 0.005], ['0.005% to <0.01%', (f) => f >= 0.005 && f < 0.01 - 1e-9],
  ['== 0.01% (Binance default clamp)', (f) => Math.abs(f - 0.01) < 1e-9], ['>0.01% to 0.02%', (f) => f > 0.01 + 1e-9 && f <= 0.02], ['> 0.02%', (f) => f > 0.02],
]
const inRange = series.t.map((T, s) => s).filter((s) => series.t[s] >= decisionRange[0] && series.t[s] < decisionRange[1])
for (const [name, f] of fb) {
  const steps = inRange.filter((s) => f(series.snapshots[s].fundingRate as number))
  const fwd = (h: number) => steps.map((s) => { const i = series.barIndex[s]; return i + h < bars.length ? bars[i + h].c / bars[i].c - 1 : NaN }).filter(Number.isFinite)
  const a = fwd(48); const b = fwd(288)
  log(`| ${name} | ${pct(steps.length / inRange.length, 1)} | ${pct(mean(a))} | ${pct(a.filter((x) => x > 0).length / a.length, 1)} | ${pct(mean(b))} | ${pct(b.filter((x) => x > 0).length / b.length, 1)} |`)
}

mkdirSync('docs/audit/data', { recursive: true })
const tag = INCLUDE_OOS ? 'with_oos' : 'decision_range'
writeFileSync(`docs/audit/data/smart_${tag}.json`, JSON.stringify(out, null, 1))
writeFileSync(`docs/audit/data/smart_${tag}.md`, md.join('\n') + '\n')
console.log(`\nwritten docs/audit/data/smart_${tag}.{json,md} in ${Date.now() - t0} ms`)
