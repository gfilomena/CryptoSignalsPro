import { edgeFetch, hasSupabaseConfig } from '../../config/supabaseClient'
import type { StrategyConfig, ScalpSymbolDef } from '../../config/strategyConfig'
import type {
  AlertEvent,
  DailyRiskStatus,
  PaperStats,
  PaperTrade,
  SignalSnapshot,
} from '../../types/scalpSignal'
import { fetchCandles } from './klines'
import { getUsdRate } from './fxRate'
import { evaluateSetup } from './strategyEngine'
import { calculateRisk, initialDailyRisk, updateDailyRisk } from './riskEngine'
import { calculateConfidenceScore } from './confidenceScore'
import { nextSignalState } from './signalStateMachine'
import { buildAlert } from './alertEngine'
import { closePaperTrade, computePaperStats, openPaperTrade } from './paperTrading'

export interface SignalDataResult {
  snapshot: SignalSnapshot
  alerts: AlertEvent[]
  paperTrades: PaperTrade[]
  paperStats: PaperStats
  source: 'server' | 'local'
}

interface LocalSignalStore {
  snapshot: SignalSnapshot | null
  lastAlert: AlertEvent | null
  dailyRisk: DailyRiskStatus
  openTrade: PaperTrade | null
  paperTrades: PaperTrade[]
  alerts: AlertEvent[]
}

function storageKey(symbol: string): string {
  return `csp_signal_local_${symbol}_v1`
}

function loadLocalStore(symbol: string): LocalSignalStore {
  const empty: LocalSignalStore = {
    snapshot: null,
    lastAlert: null,
    dailyRisk: initialDailyRisk(),
    openTrade: null,
    paperTrades: [],
    alerts: [],
  }
  if (typeof localStorage === 'undefined') return empty
  try {
    const raw = localStorage.getItem(storageKey(symbol))
    if (!raw) return empty
    return { ...empty, ...(JSON.parse(raw) as Partial<LocalSignalStore>) }
  } catch {
    return empty
  }
}

function saveLocalStore(symbol: string, store: LocalSignalStore): void {
  if (typeof localStorage === 'undefined') return
  try {
    // Cap history so localStorage never grows unbounded.
    const bounded: LocalSignalStore = {
      ...store,
      alerts: store.alerts.slice(0, 200),
      paperTrades: store.paperTrades.slice(-500),
    }
    localStorage.setItem(storageKey(symbol), JSON.stringify(bounded))
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Client-side fallback: fetches klines directly from Binance and runs the same pure engine used
 * server-side. Used when Supabase isn't configured (no background push, but the dashboard still
 * shows a live Current Signal), or as an offline-safe local mirror.
 */
async function evaluateSymbolLocally(symbolDef: ScalpSymbolDef, config: StrategyConfig): Promise<SignalDataResult> {
  const [trendCandles, entryCandles] = await Promise.all([
    fetchCandles(symbolDef.pair, config.trendTimeframe, 260),
    fetchCandles(symbolDef.pair, config.entryTimeframe, 150),
  ])

  const { setup, regime, regimeDetail, reasons } = evaluateSetup({
    symbol: symbolDef.symbol,
    trendCandles,
    entryCandles,
    config,
  })

  const store = loadLocalStore(symbolDef.symbol)
  const now = Date.now()
  const dailyRisk = updateDailyRisk(store.dailyRisk, config, {})
  const usdRate = await getUsdRate(config.capitalCurrency)
  const currentPrice = entryCandles[entryCandles.length - 1]?.close ?? 0

  const risk = setup ? calculateRisk(setup, config, dailyRisk, usdRate) : null
  const confidence = setup && risk ? calculateConfidenceScore(setup, regimeDetail, risk, config) : null

  const activeTrade = store.openTrade
    ? {
        direction: store.openTrade.direction,
        stopLoss: store.openTrade.stopLoss,
        takeProfit1: store.openTrade.takeProfit1,
        takeProfit2: store.openTrade.takeProfit2,
      }
    : null

  const prevState = store.snapshot?.state ?? 'NO_TRADE'
  const nextState = nextSignalState({
    prevState,
    regime,
    setup,
    risk,
    confidenceTotal: confidence?.total ?? 0,
    minConfidence: config.minSignalConfidence,
    activeTrade,
    currentPrice,
  })

  let targetHit: 'TP1' | 'TP2' | undefined
  if (nextState === 'TARGET_HIT' && store.openTrade) {
    const t = store.openTrade
    const reachedTp2 = t.direction === 'long' ? currentPrice >= t.takeProfit2 : currentPrice <= t.takeProfit2
    targetHit = reachedTp2 ? 'TP2' : 'TP1'
  }

  const alert = buildAlert({
    symbol: symbolDef.symbol,
    timeframe: config.entryTimeframe,
    prevState,
    nextState,
    setup,
    risk,
    confidence,
    reasons,
    targetHit,
    lastAlert: store.lastAlert,
    now,
    config,
  })

  let openTrade = store.openTrade
  let paperTrades = store.paperTrades
  let dailyRiskNext = dailyRisk

  if ((nextState === 'LONG_CONFIRMED' || nextState === 'SHORT_CONFIRMED') && !openTrade && setup && risk?.valid && confidence) {
    const trade = openPaperTrade(alert?.id ?? `${symbolDef.symbol}-${now}`, setup, risk, confidence.total, config, now)
    openTrade = trade
    paperTrades = [...paperTrades, trade]
    dailyRiskNext = updateDailyRisk(dailyRiskNext, config, { newTrade: true })
  } else if ((nextState === 'STOP_HIT' || nextState === 'TARGET_HIT') && openTrade) {
    const exitPrice =
      nextState === 'STOP_HIT' ? openTrade.stopLoss : targetHit === 'TP2' ? openTrade.takeProfit2 : openTrade.takeProfit1
    const result = nextState === 'STOP_HIT' ? 'SL' : targetHit === 'TP2' ? 'TP2' : 'TP1'
    const closed = closePaperTrade(openTrade, exitPrice, result, now, usdRate)
    paperTrades = paperTrades.map((t) => (t.id === closed.id ? closed : t))
    dailyRiskNext = updateDailyRisk(dailyRiskNext, config, { closedLossR: (closed.pnlR ?? 0) < 0 ? closed.pnlR : undefined })
    openTrade = null
  }

  const snapshot: SignalSnapshot = {
    symbol: symbolDef.symbol,
    state: nextState,
    regime,
    setup,
    risk,
    confidence,
    dailyRisk: dailyRiskNext,
    lastAlert: alert ?? store.lastAlert,
    updatedAt: now,
  }
  const alerts = alert ? [alert, ...store.alerts].slice(0, 200) : store.alerts

  saveLocalStore(symbolDef.symbol, {
    snapshot,
    lastAlert: alert ?? store.lastAlert,
    dailyRisk: dailyRiskNext,
    openTrade,
    paperTrades,
    alerts,
  })

  return { snapshot, alerts, paperTrades, paperStats: computePaperStats(paperTrades), source: 'local' }
}

async function fetchServerSignalData(symbol: string): Promise<SignalDataResult | null> {
  try {
    const res = await edgeFetch(`/signal-data?symbol=${encodeURIComponent(symbol)}`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.ok || !data.snapshot) return null
    return {
      snapshot: data.snapshot as SignalSnapshot,
      alerts: (data.alerts ?? []) as AlertEvent[],
      paperTrades: (data.paperTrades ?? []) as PaperTrade[],
      paperStats: (data.paperStats ?? computePaperStats([])) as PaperStats,
      source: 'server',
    }
  } catch {
    return null
  }
}

/**
 * Primary entry point for the UI: prefers the server-computed signal (kept in sync with the
 * scheduled Edge Function that also drives push notifications) and transparently falls back to
 * a local, client-side evaluation when Supabase isn't configured or unreachable.
 */
export async function getSignalData(config: StrategyConfig): Promise<SignalDataResult> {
  const symbolDef = config.symbols.find((s) => s.enabled) ?? config.symbols[0]

  if (hasSupabaseConfig) {
    const serverResult = await fetchServerSignalData(symbolDef.symbol)
    if (serverResult) return serverResult
  }

  return evaluateSymbolLocally(symbolDef, config)
}
