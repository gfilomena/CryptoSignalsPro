// Share of 5-minute steps (decision range) in which each single preset condition is true — a direct measure of how selective it is.
import { loadDataset, DATA_START, VAL_END } from './lib'
import { buildSnapshotSeries } from './smartReplay'
const s = buildSnapshotSeries(loadDataset())
const idx = s.t.map((t, i) => i).filter((i) => s.t[i] >= DATA_START && s.t[i] < VAL_END)
const share = (f: (x: (typeof s.snapshots)[number]) => boolean | null) => idx.filter((i) => f(s.snapshots[i]) === true).length / idx.length
const rows: [string, (x: (typeof s.snapshots)[number]) => boolean | null][] = [
  ['24h price change <= -0.5%', (x) => (x.priceChangePct as number) <= -0.5],
  ['24h price change >= +0.5%', (x) => (x.priceChangePct as number) >= 0.5],
  ['OI change 15m >= +1%', (x) => { const v = x.openInterestChangePct['15m']; return v == null ? null : v >= 1 }],
  ['OI change 15m <= -1%', (x) => { const v = x.openInterestChangePct['15m']; return v == null ? null : v <= -1 }],
  ['volume change 15m >= +20%', (x) => { const v = x.volumeChangePct['15m']; return v == null ? null : v >= 20 }],
  ['funding >= 0.01%', (x) => (x.fundingRate as number) >= 0.01 - 1e-9],
  ['funding <= 0', (x) => (x.fundingRate as number) <= 0],
  ['RSI 1h (repo variant) >= 80', (x) => (x.rsi['1h'] as number) >= 80],
]
console.log(`steps in decision range: ${idx.length}`)
for (const [n, f] of rows) console.log(`${(share(f) * 100).toFixed(2).padStart(6)}%  ${n}`)
