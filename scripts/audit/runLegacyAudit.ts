// Audit of the dashboard BUY/SELL score (src/lib/liveSignal.ts fed by src/lib/marketData.ts), BTCUSDT, 4h klines.
// Replayed on 1h steps. Two pipelines are compared on identical data:
//   FAITHFUL  = exactly what marketData.ts does: 200 klines (last = forming 4h candle) THEN prices.push(lastPrice)
//               (forming candle counted twice) and volumes.push(volume24h) (24h volume mixed into 4h volumes for OBV)
//   CORRECTED = 200 klines with the forming candle's close = lastPrice, volumes = 4h volumes only (no duplicate point)
//   npx tsx scripts/audit/runLegacyAudit.ts [--oos]
import { mkdirSync, writeFileSync } from 'node:fs'
import { Horizon, TRAIN_END, VAL_END, DATA_START, DATA_END, loadDataset, pct, summarize, toBars, type SignalEvent } from './lib'
import { analyzeLiveSignal, resetSignalStateCache } from '../../src/lib/liveSignal'
import { calculateATR, calculateBollingerBands, calculateEMA, calculateMACD, calculateOBV, calculateRSI, detectRSIDivergence } from '../../src/lib/indicators'

const INCLUDE_OOS = process.argv.includes('--oos')
const ds = loadDataset()
const h1 = ds.spot_1h
const h4 = ds.spot_4h
const H4 = 4 * 3_600_000
const bars = toBars(h1)
const HZ: Horizon[] = [{ label: '1h', bars: 1 }, { label: '4h', bars: 4 }, { label: '12h', bars: 12 }, { label: '24h', bars: 24 }, { label: '3d', bars: 72 }]
const RANGES: Record<string, [number, number]> = { train: [DATA_START, TRAIN_END], val: [TRAIN_END, VAL_END], 'train+val': [DATA_START, VAL_END], ...(INCLUDE_OOS ? { oos: [VAL_END, DATA_END] as [number, number] } : {}) }
const md: string[] = []
const log = (s = '') => { console.log(s); md.push(s) }

function run(faithful: boolean) {
  resetSignalStateCache()
  const idx4 = new Map<number, number>(h4.map((k, i) => [k.t, i]))
  const events: SignalEvent[] = []
  const types: ('buy' | 'sell' | 'neutral')[] = []
  let prev: 'buy' | 'sell' | 'neutral' = 'neutral'
  const counts = { buy: 0, sell: 0, neutral: 0 }
  for (let i = 30; i < h1.length; i++) {
    const T = h1[i].ct + 1 // wall-clock time = close of this 1h bar
    const B = Math.floor(h1[i].t / H4) * H4
    if (h1[i].t === B) continue // 1h bar opens a 4h candle => the forming 4h candle would be empty; skip (25% of hours)
    const b4 = idx4.get(B)
    if (b4 === undefined || b4 < 205) continue
    // forming 4h candle assembled from the 1h bars completed so far (uses only bars <= i)
    const partial = h1.filter((k) => k.t >= B && k.ct + 1 <= T)
    const forming = { t: B, o: partial[0].o, h: Math.max(...partial.map((k) => k.h)), l: Math.min(...partial.map((k) => k.l)), c: h1[i].c, v: partial.reduce((a, k) => a + k.v, 0) }
    const closed = h4.slice(b4 - 199, b4) // 199 closed 4h candles strictly before B
    const klines = [...closed.map((k) => [k.t, k.o, k.h, k.l, k.c, k.v]), [forming.t, forming.o, forming.h, forming.l, forming.c, forming.v]] as number[][]
    const price = h1[i].c
    const prices = klines.map((k) => k[4])
    const volumes = klines.map((k) => k[5])
    // 24h stats as Binance ticker/24hr would report at T
    const last24 = h1.slice(i - 23, i + 1)
    const volume24h = last24.reduce((a, k) => a + k.v, 0)
    const change24h = (price / h1[i - 24].c - 1) * 100
    if (faithful) { prices.push(price); volumes.push(volume24h) }
    const rsi = calculateRSI(prices)
    const macd = calculateMACD(prices)
    const bb = calculateBollingerBands(prices)
    const atr = calculateATR(klines, 14)
    const obv = calculateOBV(prices, volumes)
    const sig = analyzeLiveSignal({
      symbol: 'BTC', price, rsi, macd: macd.macd, macdHistogram: macd.histogram,
      ema20: calculateEMA(prices, 20), ema50: calculateEMA(prices, 50), ema200: calculateEMA(prices, 200), bb,
      priceChange24h: change24h, atrPct: (atr / price) * 100, obvDivergence: obv.divergence, obvTrend: obv.trend, rsiDivergence: detectRSIDivergence(prices),
    })
    types.push(sig.type)
    counts[sig.type]++
    if (sig.type !== prev && sig.type !== 'neutral') events.push({ i, dir: sig.type === 'buy' ? 1 : -1, t: T })
    prev = sig.type
  }
  return { events, counts }
}

log(`# Dashboard BUY/SELL score replay (OOS ${INCLUDE_OOS ? 'INCLUDED' : 'WITHHELD'}) — 1h steps, 4h klines, BTCUSDT spot`)
const out: Record<string, unknown> = {}
const results: Record<string, ReturnType<typeof run>> = { FAITHFUL: run(true), CORRECTED: run(false) }
for (const [name, r] of Object.entries(results)) {
  log(`\n## ${name}: state time-share buy ${pct(r.counts.buy / (r.counts.buy + r.counts.sell + r.counts.neutral), 1)} / sell ${pct(r.counts.sell / (r.counts.buy + r.counts.sell + r.counts.neutral), 1)} / neutral ${pct(r.counts.neutral / (r.counts.buy + r.counts.sell + r.counts.neutral), 1)}; entries into buy ${r.events.filter((e) => e.dir === 1).length}, into sell ${r.events.filter((e) => e.dir === -1).length}`)
  for (const dirName of ['buy', 'sell'] as const) {
    const evs = r.events.filter((e) => e.dir === (dirName === 'buy' ? 1 : -1))
    for (const [split, [from, to]] of Object.entries(RANGES)) {
      const st = summarize(bars, evs, HZ, from, to, 0.0012)
      out[`${name}_${dirName}_${split}`] = st
      log(`\n### ${name} — entry into ${dirName.toUpperCase()} — ${split}`)
      log('| horizon | n | n_indep | mean gross | median gross | mean net | 95% CI net | %>0 net | baseline | excess gross | excess net | 95% CI excess net | MFE | MAE |')
      log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
      for (const s of st) log(`| ${s.horizon} | ${s.n} | ${s.nIndep} | ${pct(s.meanGross)} | ${pct(s.medianGross)} | ${pct(s.meanNet)} | [${pct(s.ciNet[0])}, ${pct(s.ciNet[1])}] | ${pct(s.pctPositiveNet, 1)} | ${pct(s.baselineMeanGross)} | ${pct(s.excessGross)} | ${pct(s.excessNet)} | [${pct(s.ciExcessNet[0])}, ${pct(s.ciExcessNet[1])}] | ${pct(s.meanMfe)} | ${pct(s.meanMae)} |`)
    }
  }
}
mkdirSync('docs/audit/data', { recursive: true })
const tag = INCLUDE_OOS ? 'with_oos' : 'decision_range'
writeFileSync(`docs/audit/data/legacy_${tag}.json`, JSON.stringify(out, null, 1))
writeFileSync(`docs/audit/data/legacy_${tag}.md`, md.join('\n') + '\n')
