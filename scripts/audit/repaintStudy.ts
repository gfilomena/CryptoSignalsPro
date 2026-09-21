// Live-vs-backtest consistency study for the scalp engine ("repainting").
// In production the client (signalClient.ts) and the server cycle (signal-cycle) run EVERY MINUTE on
// Binance klines whose LAST candle is still forming, on all three timeframes (150x15m, 220x1h, 300x4h).
// The backtest (runBacktest / replayScalp) only ever evaluates CLOSED 15m candles. This script replays the
// live behaviour minute by minute from 1-minute data — each timeframe's last candle is assembled from the
// 1m bars seen so far (no future information) — and compares it with the closed-candle replay.
//   npx tsx scripts/audit/repaintStudy.ts [--from=2025-09] [--to=2025-12] [--mode=forming|closed]
//   forming = BEFORE the fix (engine fed the forming candle);  closed = AFTER (closed candles only, 1m price used only for SL/TP)
import { mkdirSync, writeFileSync } from 'node:fs'
import { klines, months, CACHE } from './download'
import { loadDataset, mean, num, pct } from './lib'
import { replayScalp } from './scalpReplay'
import type { Candle, AlertEvent, PaperTrade, SignalState } from '../../src/types/scalpSignal'
import { DEFAULT_STRATEGY_CONFIG as CFG } from '../../src/config/strategyConfig'
import { evaluateSetup } from '../../src/lib/scalp/strategyEngine'
import { calculateRisk, initialDailyRisk, updateDailyRisk } from '../../src/lib/scalp/riskEngine'
import { calculateConfidenceScore } from '../../src/lib/scalp/confidenceScore'
import { nextSignalState } from '../../src/lib/scalp/signalStateMachine'
import { buildAlert } from '../../src/lib/scalp/alertEngine'
import { closePaperTrade, openPaperTrade } from '../../src/lib/scalp/paperTrading'

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d
const FROM = arg('from', '2025-09')
const TO = arg('to', '2025-12')
const MODE = arg('mode', 'forming') as 'forming' | 'closed'
const MIN = 60_000
const toC = (k: { t: number; o: number; h: number; l: number; c: number; v: number; ct: number }): Candle => ({ openTime: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v, closeTime: k.ct })

async function main() {
  mkdirSync(`${CACHE}/raw`, { recursive: true })
  const m1 = await klines('spot', '1m', months(FROM, TO))
  const ds = loadDataset()
  const c15 = ds.spot_15m.map(toC), c1h = ds.spot_1h.map(toC), c4h = ds.spot_4h.map(toC)
  const at = (arr: Candle[]) => new Map(arr.map((c, i) => [c.openTime, i]))
  const i15 = at(c15), i1h = at(c1h), i4h = at(c4h)
  const start = m1[0].t
  const end = m1[m1.length - 1].ct + 1
  console.log(`1m bars: ${m1.length}  ${new Date(start).toISOString()} -> ${new Date(end).toISOString()}`)

  // forming candle of a bucket as seen at 1m bar index `upto` (uses 1m bars <= upto only)
  const forming = (bucketMs: number, upto: number): Candle => {
    const B = Math.floor(m1[upto].t / bucketMs) * bucketMs
    let o = m1[upto].o, h = m1[upto].h, l = m1[upto].l, v = 0
    const c = m1[upto].c
    for (let j = upto; j >= 0 && m1[j].t >= B; j--) {
      o = m1[j].o
      h = Math.max(h, m1[j].h)
      l = Math.min(l, m1[j].l)
      v += m1[j].v
    }
    return { openTime: B, open: o, high: h, low: l, close: c, volume: v, closeTime: B + bucketMs - 1 }
  }
  const withForming = (map: Map<number, number>, arr: Candle[], n: number, f: Candle): Candle[] | null => {
    const idx = map.get(f.openTime)
    if (idx === undefined || idx < n) return null
    return MODE === 'closed' ? arr.slice(idx - n, idx) : [...arr.slice(idx - (n - 1), idx), f]
  }

  // ---- live-like minute-by-minute replay -------------------------------------------------------
  let dailyRisk = initialDailyRisk()
  let open: PaperTrade | null = null
  let prevState: SignalState = 'NO_TRADE'
  let lastAlert: AlertEvent | null = null
  const liveEntries: { t: number; dir: 1 | -1; bucket: number }[] = []
  const liveTrades: number[] = []
  const cnt: Record<string, number> = { SETUP_DETECTED: 0, ENTRY_CONFIRMED: 0, SETUP_INVALIDATED: 0 }
  for (let m = 0; m < m1.length; m++) {
    const T = m1[m].ct + 1
    const f15 = forming(15 * MIN, m)
    const entry = withForming(i15, c15, 150, f15)
    const structure = withForming(i1h, c1h, 220, forming(60 * MIN, m))
    const trend = withForming(i4h, c4h, 300, forming(240 * MIN, m))
    if (!entry || !structure || !trend) continue
    const nowDate = new Date(T)
    dailyRisk = updateDailyRisk(dailyRisk, CFG, {}, nowDate)
    const price = m1[m].c
    const { setup, regime, regimeDetail, zones, reasons } = evaluateSetup({ symbol: 'BTC', trendCandles: trend, structureCandles: structure, entryCandles: entry, config: CFG })
    const risk = setup ? calculateRisk(setup, zones, CFG, dailyRisk, 1) : null
    const conf = setup && risk ? calculateConfidenceScore(setup, regimeDetail, risk, CFG) : null
    const activeTrade = open ? { direction: open.direction, stopLoss: open.stopLoss, takeProfit1: open.takeProfit1, takeProfit2: open.takeProfit2 } : null
    const next = nextSignalState({ prevState, regime, setup, risk, confidenceTotal: conf?.total ?? 0, minConfidence: CFG.minSignalConfidence, activeTrade, currentPrice: price })
    let targetHit: 'TP1' | 'TP2' | undefined
    if (next === 'TARGET_HIT' && open) targetHit = (open.direction === 'long' ? price >= open.takeProfit2 : price <= open.takeProfit2) ? 'TP2' : 'TP1'
    const alert = buildAlert({ symbol: 'BTC', timeframe: CFG.entryTimeframe, prevState, nextState: next, setup, risk, confidence: conf, reasons, targetHit, lastAlert, now: T, config: CFG })
    if (alert) {
      lastAlert = alert
      if (alert.type in cnt) cnt[alert.type]++
      if (alert.type === 'ENTRY_CONFIRMED' && setup) liveEntries.push({ t: T, dir: setup.direction === 'long' ? 1 : -1, bucket: f15.openTime })
    }
    if ((next === 'LONG_CONFIRMED' || next === 'SHORT_CONFIRMED') && !open && setup && risk?.valid && conf) {
      open = openPaperTrade(`live-${m}`, setup, risk, conf.total, CFG, T)
      dailyRisk = updateDailyRisk(dailyRisk, CFG, { newTrade: true }, nowDate)
    } else if ((next === 'STOP_HIT' || next === 'TARGET_HIT') && open) {
      const exit = next === 'STOP_HIT' ? open.stopLoss : targetHit === 'TP2' ? open.takeProfit2 : open.takeProfit1
      const closed = closePaperTrade(open, exit, next === 'STOP_HIT' ? 'SL' : targetHit === 'TP2' ? 'TP2' : 'TP1', T, 1)
      liveTrades.push(closed.pnlR ?? 0)
      dailyRisk = updateDailyRisk(dailyRisk, CFG, { closedLossR: (closed.pnlR ?? 0) < 0 ? closed.pnlR : undefined }, nowDate)
      open = null
    }
    prevState = next
  }

  // ---- closed-candle replay on the same period ---------------------------------------------------
  const closed = replayScalp(ds.spot_15m, ds.spot_1h, ds.spot_4h, CFG, { from: start, to: end })
  const cEntries = closed.events.filter((e) => e.type === 'ENTRY_CONFIRMED')
  const cTrades = closed.trades.filter((t) => t.entryT >= start && t.entryT < end)

  // ---- did each intrabar ENTRY survive to its candle close? ----------------------------------------
  let survived = 0
  for (const e of liveEntries) {
    const idx = i15.get(e.bucket)!
    const cutoff = c15[idx].closeTime
    let p1 = 0, p4 = 0
    while (p1 + 1 < c1h.length && c1h[p1 + 1].closeTime <= cutoff) p1++
    while (p4 + 1 < c4h.length && c4h[p4 + 1].closeTime <= cutoff) p4++
    const r = evaluateSetup({ symbol: 'BTC', trendCandles: c4h.slice(p4 - 299, p4 + 1), structureCandles: c1h.slice(p1 - 219, p1 + 1), entryCandles: c15.slice(idx - 149, idx + 1), config: CFG })
    const risk = r.setup ? calculateRisk(r.setup, r.zones, CFG, initialDailyRisk(), 1) : null
    const conf = r.setup && risk ? calculateConfidenceScore(r.setup, r.regimeDetail, risk, CFG) : null
    const dirOk = r.setup && (r.setup.direction === 'long' ? 1 : -1) === e.dir
    if (dirOk && r.setup!.confirmation.confirmed && risk?.valid && (conf?.total ?? 0) >= CFG.minSignalConfidence) survived++
  }
  const days = (end - start) / 86_400_000
  const out = {
    mode: MODE, period: `${new Date(start).toISOString().slice(0, 10)} → ${new Date(end).toISOString().slice(0, 10)}`, days,
    live: { ...cnt, trades: liveTrades.length, meanNetR: mean(liveTrades), totalNetR: liveTrades.reduce((a, b) => a + b, 0) },
    closed: {
      ENTRY_CONFIRMED: cEntries.length, trades: cTrades.length, meanNetR: mean(cTrades.map((t) => t.pnlRNet)), totalNetR: cTrades.reduce((a, t) => a + t.pnlRNet, 0),
      SETUP_DETECTED: closed.events.filter((e) => e.type === 'SETUP_DETECTED').length, SETUP_INVALIDATED: closed.events.filter((e) => e.type === 'SETUP_INVALIDATED').length,
    },
    liveEntriesSurvivingToClose: survived, liveEntries: liveEntries.length,
  }
  console.log(JSON.stringify(out, null, 1))
  console.log(`intrabar ENTRY_CONFIRMED still valid on the closed candle: ${survived}/${liveEntries.length} = ${pct(survived / Math.max(1, liveEntries.length), 1)}; live-like mean net R ${num(out.live.meanNetR)} vs closed-candle ${num(out.closed.meanNetR)}`)
  mkdirSync('docs/audit/data', { recursive: true })
  writeFileSync(`docs/audit/data/repaint_study_${MODE}_${FROM}_${TO}.json`, JSON.stringify(out, null, 1))
}
main().catch((e) => { console.error(e); process.exit(1) })
