// Compares the repo's RSI (simple averages over the last 14 changes) with the standard Wilder RSI on 1h closes.
import { loadDataset, DATA_START, VAL_END, mean } from './lib'
import { calculateRSI } from '../../src/lib/indicators'
const ds = loadDataset()
const k = ds.fut_1h.filter((x) => x.ct < VAL_END && x.t >= DATA_START)
const closes = k.map((x) => x.c)
function wilder(cs: number[], p = 14): number[] {
  const out: number[] = new Array(cs.length).fill(NaN)
  let ag = 0, al = 0
  for (let i = 1; i <= p; i++) { const d = cs[i] - cs[i - 1]; if (d > 0) ag += d; else al -= d }
  ag /= p; al /= p
  out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  for (let i = p + 1; i < cs.length; i++) {
    const d = cs[i] - cs[i - 1]
    ag = (ag * (p - 1) + Math.max(d, 0)) / p
    al = (al * (p - 1) + Math.max(-d, 0)) / p
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  }
  return out
}
const w = wilder(closes)
const s = closes.map((_, i) => (i >= 15 ? calculateRSI(closes.slice(0, i + 1)) : NaN))
const idx = closes.map((_, i) => i).filter((i) => i >= 200)
const share = (a: number[], f: (x: number) => boolean) => idx.filter((i) => f(a[i])).length / idx.length
console.log('bars', idx.length)
console.log('share RSI>=80  repo(simple):', (share(s, (x) => x >= 80) * 100).toFixed(2) + '%', ' Wilder:', (share(w, (x) => x >= 80) * 100).toFixed(2) + '%')
console.log('share RSI>=70  repo(simple):', (share(s, (x) => x >= 70) * 100).toFixed(2) + '%', ' Wilder:', (share(w, (x) => x >= 70) * 100).toFixed(2) + '%')
console.log('mean |repo - Wilder|:', mean(idx.map((i) => Math.abs(s[i] - w[i]))).toFixed(2), 'points; max', Math.max(...idx.map((i) => Math.abs(s[i] - w[i]))).toFixed(1))
