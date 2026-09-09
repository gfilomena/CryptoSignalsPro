import type { Candle, PaperStats, PaperTrade, SignalState } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'
import { evaluateSetup } from './strategyEngine'
import { calculateRisk, initialDailyRisk, todayKey, updateDailyRisk } from './riskEngine'
import { calculateConfidenceScore } from './confidenceScore'
import { nextSignalState } from './signalStateMachine'
import { closePaperTrade, computePaperStats, openPaperTrade } from './paperTrading'

export interface BacktestResult {
  stats: PaperStats
  trades: PaperTrade[]
  /** Trading days that saw at least one CONFIRMED entry, out of all simulated days. */
  totalDays: number
  daysWithATrade: number
  noTradeDays: number
  signalsPerDay: number
}

/**
 * Walk-forward, no-look-ahead backtest. At each entry-timeframe candle, only candles whose close
 * is at or before the current one are visible to the engine — the exact same evaluateSetup/
 * calculateRisk/calculateConfidenceScore/nextSignalState/paper-trading functions used by the live
 * client and the scheduled server cycle, so a backtest result reflects the real strategy, not a
 * separate approximation of it. While a paper trade is open, no new setup is searched (mirrors
 * live behavior). Stop/target fills are checked against each candle's high/low (not just close)
 * for a realistic simulation; if both a stop and a target would trigger within the same candle,
 * the stop is assumed to hit first — the conservative assumption, never the one that flatters
 * results.
 */
export function runBacktest(
  trendCandles: Candle[],
  structureCandles: Candle[],
  entryCandles: Candle[],
  config: StrategyConfig,
): BacktestResult {
  let dailyRisk = initialDailyRisk()
  let openTrade: PaperTrade | null = null
  let prevState: SignalState = 'NO_TRADE'
  const trades: PaperTrade[] = []
  const allDays = new Set<string>()
  const tradeDays = new Set<string>()

  const minWarmup = Math.max(config.emaSlow + 2, config.pullbackMaxBars + 3)

  for (let i = minWarmup; i < entryCandles.length; i++) {
    const entrySlice = entryCandles.slice(0, i + 1)
    const last = entrySlice[entrySlice.length - 1]
    const cutoff = last.closeTime
    const nowDate = new Date(cutoff)
    allDays.add(todayKey(nowDate))

    dailyRisk = updateDailyRisk(dailyRisk, config, {}, nowDate)

    if (openTrade) {
      const hitStop = openTrade.direction === 'long' ? last.low <= openTrade.stopLoss : last.high >= openTrade.stopLoss
      const hitTp2 = openTrade.direction === 'long' ? last.high >= openTrade.takeProfit2 : last.low <= openTrade.takeProfit2
      const hitTp1 = openTrade.direction === 'long' ? last.high >= openTrade.takeProfit1 : last.low <= openTrade.takeProfit1

      if (hitStop) {
        const closed = closePaperTrade(openTrade, openTrade.stopLoss, 'SL', cutoff, 1)
        trades.push(closed)
        dailyRisk = updateDailyRisk(dailyRisk, config, { closedLossR: (closed.pnlR ?? 0) < 0 ? closed.pnlR : undefined }, nowDate)
        openTrade = null
        prevState = 'STOP_HIT'
      } else if (hitTp2) {
        const closed = closePaperTrade(openTrade, openTrade.takeProfit2, 'TP2', cutoff, 1)
        trades.push(closed)
        openTrade = null
        prevState = 'TARGET_HIT'
      } else if (hitTp1) {
        const closed = closePaperTrade(openTrade, openTrade.takeProfit1, 'TP1', cutoff, 1)
        trades.push(closed)
        openTrade = null
        prevState = 'TARGET_HIT'
      }
      continue
    }

    const trendSlice = trendCandles.filter((c) => c.closeTime <= cutoff)
    const structureSlice = structureCandles.filter((c) => c.closeTime <= cutoff)

    const { setup, regime, regimeDetail, zones } = evaluateSetup({
      symbol: 'BACKTEST',
      trendCandles: trendSlice,
      structureCandles: structureSlice,
      entryCandles: entrySlice,
      config,
    })
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

    if ((nextState === 'LONG_CONFIRMED' || nextState === 'SHORT_CONFIRMED') && setup && risk?.valid && confidence) {
      openTrade = openPaperTrade(`bt-${i}`, setup, risk, confidence.total, config, cutoff)
      dailyRisk = updateDailyRisk(dailyRisk, config, { newTrade: true }, nowDate)
      tradeDays.add(todayKey(nowDate))
    }
    prevState = nextState
  }

  const stats = computePaperStats(trades)
  const totalDays = allDays.size
  const daysWithATrade = tradeDays.size
  return {
    stats,
    trades,
    totalDays,
    daysWithATrade,
    noTradeDays: totalDays - daysWithATrade,
    signalsPerDay: totalDays > 0 ? trades.length / totalDays : 0,
  }
}
