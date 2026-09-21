// Chronological replay of the production scalp engine (src/lib/scalp/*) over historical BTCUSDT
// spot candles. It calls the SAME pure functions as the live client / server cycle
// (evaluateSetup -> calculateRisk -> calculateConfidenceScore -> nextSignalState -> buildAlert),
// but — unlike runBacktest() — it (a) feeds the engine the same window sizes the live path uses
// (300 x 4h / 220 x 1h / 150 x 15m) and (b) records EVERY alert type, not only executed trades.
//
// Look-ahead control: at bar i only candles with closeTime <= closeTime(i) are visible.
import type { Kline } from './download'
import type { Candle, AlertEvent, PaperTrade, SignalState } from '../../src/types/scalpSignal'
import { DEFAULT_STRATEGY_CONFIG, type StrategyConfig } from '../../src/config/strategyConfig'
import { evaluateSetup } from '../../src/lib/scalp/strategyEngine'
import { calculateRisk, initialDailyRisk, updateDailyRisk } from '../../src/lib/scalp/riskEngine'
import { calculateConfidenceScore } from '../../src/lib/scalp/confidenceScore'
import { nextSignalState } from '../../src/lib/scalp/signalStateMachine'
import { buildAlert } from '../../src/lib/scalp/alertEngine'
import { closePaperTrade, openPaperTrade } from '../../src/lib/scalp/paperTrading'
import { detectExitSignal } from '../../src/lib/scalp/exitSignal'
import { detectRegime } from '../../src/lib/scalp/regime'

export type ReplayEventType = 'SETUP_DETECTED' | 'ENTRY_CONFIRMED' | 'SETUP_INVALIDATED' | 'EXIT_SUGGESTED' | 'STOP_HIT' | 'TP1_HIT' | 'TP2_HIT'

export interface ReplayEvent {
  type: ReplayEventType
  dir: 1 | -1 | 0
  /** index into the spot 15m series of the bar whose CLOSE produced the event */
  i: number
  t: number
  price: number
  confidence?: number
  reasons?: string[]
  regime: 'bullish' | 'bearish' | 'neutral'
}

export interface ReplayTrade {
  entryI: number
  exitI: number
  dir: 1 | -1
  result: string
  pnlRNet: number
  pnlRGross: number
  entryT: number
  confidence: number
  regime: 'bullish' | 'bearish' | 'neutral'
  /** net R if the trade had been closed at the EXIT_SUGGESTED price instead (undefined if never suggested) */
  pnlRAtExitSuggestion?: number
}

export interface ReplayResult {
  events: ReplayEvent[]
  trades: ReplayTrade[]
  barsEvaluated: number
  /** share of evaluated bars per 4h regime */
  regimeShare: Record<string, number>
}

const toCandle = (k: Kline): Candle => ({ openTime: k.t, open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v, closeTime: k.ct })

const dirOf = (d: 'long' | 'short'): 1 | -1 => (d === 'long' ? 1 : -1)

export function replayScalp(
  spot15: Kline[],
  spot1h: Kline[],
  spot4h: Kline[],
  config: StrategyConfig = DEFAULT_STRATEGY_CONFIG,
  opts: { from?: number; to?: number } = {},
): ReplayResult {
  const c15 = spot15.map(toCandle)
  const c1h = spot1h.map(toCandle)
  const c4h = spot4h.map(toCandle)

  const events: ReplayEvent[] = []
  const trades: ReplayTrade[] = []
  const regimeCount: Record<string, number> = { bullish: 0, bearish: 0, neutral: 0 }

  let dailyRisk = initialDailyRisk()
  let open: { trade: PaperTrade; entryI: number; regime: ReplayEvent['regime']; suggestedPnlR?: number } | null = null
  let prevState: SignalState = 'NO_TRADE'
  let lastAlert: AlertEvent | null = null
  let p1 = -1
  let p4 = -1
  let barsEvaluated = 0
  /** direction of the most recent setup, so SETUP_INVALIDATED (whose own setup is null) can be attributed */
  let lastSetupDir: 1 | -1 = 1

  const push = (e: ReplayEvent) => events.push(e)
  const warmup = 150

  for (let i = 0; i < c15.length; i++) {
    const last = c15[i]
    const cutoff = last.closeTime
    while (p1 + 1 < c1h.length && c1h[p1 + 1].closeTime <= cutoff) p1++
    while (p4 + 1 < c4h.length && c4h[p4 + 1].closeTime <= cutoff) p4++
    if (i < warmup || p4 < config.emaSlow + 1) continue
    if (opts.from !== undefined && cutoff < opts.from) continue
    if (opts.to !== undefined && cutoff >= opts.to) break

    const entry = c15.slice(i - 149, i + 1)
    const structure = c1h.slice(Math.max(0, p1 - 219), p1 + 1)
    const trend = c4h.slice(Math.max(0, p4 - 299), p4 + 1)
    const nowDate = new Date(cutoff)
    dailyRisk = updateDailyRisk(dailyRisk, config, {}, nowDate)
    barsEvaluated++

    // ---- manage an open paper trade first (same rules as runBacktest: stop assumed first within a bar)
    if (open) {
      const t = open.trade
      const long = t.direction === 'long'
      const hitStop = long ? last.low <= t.stopLoss : last.high >= t.stopLoss
      const hitTp2 = long ? last.high >= t.takeProfit2 : last.low <= t.takeProfit2
      const hitTp1 = long ? last.high >= t.takeProfit1 : last.low <= t.takeProfit1
      const finish = (price: number, result: 'SL' | 'TP1' | 'TP2', type: ReplayEventType) => {
        const closed = closePaperTrade(t, price, result, cutoff, 1)
        const costUsd = t.entryPrice * t.positionSize * (t.costPct / 100)
        trades.push({
          entryI: open!.entryI,
          exitI: i,
          dir: dirOf(t.direction),
          result,
          pnlRNet: closed.pnlR ?? 0,
          pnlRGross: (closed.pnlR ?? 0) + costUsd / t.riskAmount,
          entryT: t.openedAt,
          confidence: t.confidence,
          regime: open!.regime,
          pnlRAtExitSuggestion: open!.suggestedPnlR,
        })
        push({ type, dir: dirOf(t.direction), i, t: cutoff, price, regime: open!.regime })
        dailyRisk = updateDailyRisk(dailyRisk, config, { closedLossR: (closed.pnlR ?? 0) < 0 ? closed.pnlR : undefined }, nowDate)
        prevState = result === 'SL' ? 'STOP_HIT' : 'TARGET_HIT'
        open = null
      }
      if (hitStop) finish(t.stopLoss, 'SL', 'STOP_HIT')
      else if (hitTp2) finish(t.takeProfit2, 'TP2', 'TP2_HIT')
      else if (hitTp1) finish(t.takeProfit1, 'TP1', 'TP1_HIT')
      else if (!t.exitSuggested) {
        const exit = detectExitSignal(entry, t.direction, config)
        if (exit.suggested) {
          open.trade = { ...t, exitSuggested: true }
          open.suggestedPnlR = closePaperTrade(t, last.close, 'EXPIRED', cutoff, 1).pnlR ?? 0
          push({ type: 'EXIT_SUGGESTED', dir: dirOf(t.direction), i, t: cutoff, price: last.close, regime: open.regime })
        }
      }
      continue
    }

    const { setup, regime, regimeDetail, zones, reasons } = evaluateSetup({ symbol: 'BTC', trendCandles: trend, structureCandles: structure, entryCandles: entry, config })
    regimeCount[regime]++
    const risk = setup ? calculateRisk(setup, zones, config, dailyRisk, 1) : null
    const confidence = setup && risk ? calculateConfidenceScore(setup, regimeDetail, risk, config) : null
    const nextState = nextSignalState({
      prevState,
      regime,
      setup,
      risk,
      confidenceTotal: confidence?.total ?? 0,
      minConfidence: config.minSignalConfidence,
      activeTrade: null,
      currentPrice: last.close,
    })

    if (setup) lastSetupDir = dirOf(setup.direction)
    const alert = buildAlert({
      symbol: 'BTC',
      timeframe: config.entryTimeframe,
      prevState,
      nextState,
      setup,
      risk,
      confidence,
      reasons,
      lastAlert,
      now: cutoff,
      config,
    })
    if (alert) {
      lastAlert = alert
      if (alert.type === 'SETUP_DETECTED' || alert.type === 'ENTRY_CONFIRMED' || alert.type === 'SETUP_INVALIDATED') {
        const dir = alert.direction ? dirOf(alert.direction) : setup ? dirOf(setup.direction) : lastSetupDir
        push({ type: alert.type, dir, i, t: cutoff, price: last.close, confidence: confidence?.total, reasons, regime })
      }
    }

    if ((nextState === 'LONG_CONFIRMED' || nextState === 'SHORT_CONFIRMED') && setup && risk?.valid && confidence) {
      open = { trade: openPaperTrade(`bt-${i}`, setup, risk, confidence.total, config, cutoff), entryI: i, regime }
      dailyRisk = updateDailyRisk(dailyRisk, config, { newTrade: true }, nowDate)
    }
    prevState = nextState
  }

  const total = Object.values(regimeCount).reduce((a, b) => a + b, 0) || 1
  return {
    events,
    trades,
    barsEvaluated,
    regimeShare: { bullish: regimeCount.bullish / total, bearish: regimeCount.bearish / total, neutral: regimeCount.neutral / total },
  }
}

/** 4h regime label as-of a 15m bar close (used for regime slicing of ANY signal). */
export function regimeSeries(spot15: Kline[], spot4h: Kline[], config: StrategyConfig = DEFAULT_STRATEGY_CONFIG): ('bullish' | 'bearish' | 'neutral')[] {
  const c4h = spot4h.map(toCandle)
  const out: ('bullish' | 'bearish' | 'neutral')[] = new Array(spot15.length).fill('neutral')
  const perBar4h: ('bullish' | 'bearish' | 'neutral')[] = c4h.map((_, idx) => {
    if (idx < config.emaSlow + 1) return 'neutral'
    return detectRegime(c4h.slice(Math.max(0, idx - 299), idx + 1), config).regime
  })
  let p = -1
  for (let i = 0; i < spot15.length; i++) {
    while (p + 1 < c4h.length && c4h[p + 1].closeTime <= spot15[i].ct) p++
    out[i] = p >= 0 ? perBar4h[p] : 'neutral'
  }
  return out
}
