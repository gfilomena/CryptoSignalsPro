// Does volume carry directional information on BTCUSDT? Relative volume (vs the previous 24 bars) x taker
// buy/sell imbalance (taker-buy base volume / total volume, from the klines' 10th column), on 1h spot bars.
// Descriptive + forward-return test, decision range first; --oos unlocks the held-out period.
//   npx tsx scripts/audit/volumeStudy.ts [--oos]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE, DATA_END, DATA_START, VAL_END, ROUND_TRIP_COST, baseline, bootstrapMeanCI, forward, mean, pct, type Bar } from './lib'
import { months } from './download'

const OOS = process.argv.includes('--oos')
const toMs = (t: number) => (t > 1e14 ? Math.floor(t / 1000) : t)
interface Row { bar: Bar; v: number; tb: number }
const rows: Row[] = []
for (const m of months('2023-09', '2026-08')) {
  const f = join(CACHE, 'raw', `spot-klines-1h-${m}.csv`)
  if (!existsSync(f)) throw new Error(`missing ${f} — run scripts/audit/download.ts first`)
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!/^\d/.test(l)) continue
    const c = l.split(',')
    rows.push({ bar: { t: toMs(+c[0]), o: +c[1], h: +c[2], l: +c[3], c: +c[4], ct: toMs(+c[6]) }, v: +c[5], tb: +c[9] })
  }
}
rows.sort((a, b) => a.bar.t - b.bar.t)
const bars = rows.map((r) => r.bar)
const range: [number, number] = OOS ? [VAL_END, DATA_END] : [DATA_START, VAL_END]

const rvBuckets: [string, (x: number) => boolean][] = [['RV<0.8', (x) => x < 0.8], ['0.8-1.5', (x) => x >= 0.8 && x < 1.5], ['1.5-2.5', (x) => x >= 1.5 && x < 2.5], ['RV>=2.5', (x) => x >= 2.5]]
const tbBuckets: [string, (x: number) => boolean][] = [['sell-dominated (TBR<=0.47)', (x) => x <= 0.47], ['balanced', (x) => x > 0.47 && x < 0.53], ['buy-dominated (TBR>=0.53)', (x) => x >= 0.53]]
const HZ = [{ label: '1h', bars: 1 }, { label: '4h', bars: 4 }, { label: '24h', bars: 24 }]

const lines: string[] = []
const log = (s = '') => { console.log(s); lines.push(s) }
log(`# Volume study — BTCUSDT spot 1h (${OOS ? 'OOS ONLY' : 'decision range: train+val'}); returns are RAW (long), from the close of the bar the volume readings belong to`)
log('excess = mean forward return of the bucket minus the unconditional mean over the same range; CI = seeded bootstrap of the bucket mean minus that baseline (gross of costs)')
log('| relative volume | taker imbalance | n | fwd 1h excess [95% CI] | fwd 4h excess [95% CI] | fwd 24h excess [95% CI] | %up 4h |')
log('|---|---|---|---|---|---|---|')
const out: unknown[] = []
for (const [rn, rf] of rvBuckets) for (const [tn, tf] of tbBuckets) {
  const idx: number[] = []
  for (let i = 24; i < rows.length; i++) {
    if (bars[i].ct < range[0] || bars[i].ct >= range[1]) continue
    const avg = mean(rows.slice(i - 24, i).map((r) => r.v))
    if (rf(rows[i].v / avg) && tf(rows[i].tb / rows[i].v)) idx.push(i)
  }
  const cells = HZ.map((h) => {
    const fw = idx.map((i) => forward(bars, i, 1, h.bars)?.ret).filter((x): x is number => x !== undefined)
    const base = baseline(bars, 1, h.bars, range[0], range[1])
    const ci = bootstrapMeanCI(fw.map((x) => x - base))
    return { h: h.label, n: fw.length, excess: mean(fw) - base, ci, up: fw.filter((x) => x > 0).length / (fw.length || 1) }
  })
  out.push({ rn, tn, n: idx.length, cells })
  const f = (c: (typeof cells)[number]) => `${pct(c.excess)} [${pct(c.ci[0])}, ${pct(c.ci[1])}]${c.ci[0] > 0 || c.ci[1] < 0 ? ' *' : ''}`
  log(`| ${rn} | ${tn} | ${idx.length} | ${f(cells[0])} | ${f(cells[1])} | ${f(cells[2])} | ${pct(cells[1].up, 1)} |`)
}
log('\n`*` = 95% CI excludes 0 (12 cells x 3 horizons = 36 tests: ~2 false positives expected by chance alone; only a cell that repeats with the same sign out-of-sample would count).')
log(`Round-trip cost to beat: ${pct(ROUND_TRIP_COST, 2)}.`)
writeFileSync(`docs/audit/data/volume_${OOS ? 'oos' : 'decision_range'}.md`, lines.join('\n') + '\n')
writeFileSync(`docs/audit/data/volume_${OOS ? 'oos' : 'decision_range'}.json`, JSON.stringify(out, null, 1))
