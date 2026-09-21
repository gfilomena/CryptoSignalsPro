// Data-quality checks on the cached audit dataset: gaps, duplicates, ordering, sanity of OHLC,
// funding interval, OI gaps. Output feeds PARAMETER_AUDIT.md §data-quality.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE, type Kline } from './download'

const d = JSON.parse(readFileSync(join(CACHE, 'dataset.json'), 'utf8'))

function checkKlines(name: string, ks: Kline[], stepMs: number) {
  let dup = 0, gaps = 0, missing = 0, unordered = 0, badOhlc = 0, zeroVol = 0, maxGap = 0
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]
    if (k.h < Math.max(k.o, k.c) || k.l > Math.min(k.o, k.c) || k.l <= 0) badOhlc++
    if (k.v === 0) zeroVol++
    if (i === 0) continue
    const dt = k.t - ks[i - 1].t
    if (dt === 0) dup++
    else if (dt < 0) unordered++
    else if (dt > stepMs) { gaps++; missing += dt / stepMs - 1; maxGap = Math.max(maxGap, dt / stepMs - 1) }
  }
  console.log(`${name}: n=${ks.length} first=${new Date(ks[0].t).toISOString()} last=${new Date(ks[ks.length - 1].t).toISOString()} dup=${dup} unordered=${unordered} gaps=${gaps} missingBars=${missing} maxGapBars=${maxGap} badOhlc=${badOhlc} zeroVol=${zeroVol}`)
}
checkKlines('spot 15m', d.spot_15m, 15 * 60_000)
checkKlines('spot 1h', d.spot_1h, 3600_000)
checkKlines('spot 4h', d.spot_4h, 4 * 3600_000)
checkKlines('fut 15m', d.fut_15m, 15 * 60_000)
checkKlines('fut 1h', d.fut_1h, 3600_000)

const oi: { t: number; oi: number }[] = d.oi
let oiGaps = 0, oiMissing = 0, oiMaxGap = 0, oiDup = 0, oiZero = 0
for (let i = 1; i < oi.length; i++) {
  const dt = oi[i].t - oi[i - 1].t
  if (dt === 0) oiDup++
  else if (dt > 300_000) { oiGaps++; oiMissing += dt / 300_000 - 1; oiMaxGap = Math.max(oiMaxGap, dt / 300_000 - 1) }
  if (oi[i].oi <= 0) oiZero++
}
console.log(`OI 5m: n=${oi.length} dup=${oiDup} gaps=${oiGaps} missing5mPoints=${oiMissing} maxGap(5m pts)=${oiMaxGap} nonPositive=${oiZero}`)
const jumps = oi.slice(1).map((p, i) => Math.abs(p.oi / oi[i].oi - 1) * 100).sort((a, b) => a - b)
console.log(`OI 5m |change| pct: median=${jumps[jumps.length >> 1].toFixed(3)} p99=${jumps[Math.floor(jumps.length * 0.99)].toFixed(3)} max=${jumps[jumps.length - 1].toFixed(2)}`)

const f: { t: number; intervalH: number; rate: number }[] = d.funding
const ivs = new Map<number, number>()
f.forEach((p) => ivs.set(p.intervalH, (ivs.get(p.intervalH) ?? 0) + 1))
const rates = f.map((p) => p.rate * 100).sort((a, b) => a - b)
const q = (p: number) => rates[Math.floor((rates.length - 1) * p)]
console.log(`funding: n=${f.length} intervals=${JSON.stringify([...ivs])} pct: min=${q(0).toFixed(4)} p5=${q(0.05).toFixed(4)} p25=${q(0.25).toFixed(4)} median=${q(0.5).toFixed(4)} p75=${q(0.75).toFixed(4)} p95=${q(0.95).toFixed(4)} max=${q(1).toFixed(4)}`)
console.log(`funding share >= 0.01%: ${(rates.filter((r) => r >= 0.01).length / rates.length * 100).toFixed(1)}%  share <= 0: ${(rates.filter((r) => r <= 0).length / rates.length * 100).toFixed(1)}%  share == 0.01 exactly: ${(rates.filter((r) => Math.abs(r - 0.01) < 1e-9).length / rates.length * 100).toFixed(1)}%`)

// spot vs futures close basis sanity
let n = 0, sumAbs = 0, maxAbs = 0
const fut = new Map<number, number>(d.fut_15m.map((k: Kline) => [k.t, k.c]))
for (const k of d.spot_15m as Kline[]) {
  const fc = fut.get(k.t)
  if (fc === undefined) continue
  const b = Math.abs(fc / k.c - 1) * 100
  n++; sumAbs += b; maxAbs = Math.max(maxAbs, b)
}
console.log(`spot vs futures 15m close: n=${n} mean|basis|=${(sumAbs / n).toFixed(4)}% max=${maxAbs.toFixed(3)}%`)
