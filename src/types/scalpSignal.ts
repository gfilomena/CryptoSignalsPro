import type { Currency } from './domain'

export type MarketRegime = 'bullish' | 'bearish' | 'neutral'
export type TradeDirection = 'long' | 'short'
export type SetupType = 'ZONE_REACTION' | 'BREAKOUT_PULLBACK_RETEST'

export type SignalState =
  | 'NO_TRADE'
  | 'WATCH'
  | 'LONG_SETUP'
  | 'LONG_CONFIRMED'
  | 'SHORT_SETUP'
  | 'SHORT_CONFIRMED'
  | 'TRADE_ACTIVE'
  | 'TARGET_HIT'
  | 'STOP_HIT'
  | 'EXPIRED'

export interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closeTime: number
}

/** A historically significant support/resistance band on the structure timeframe (1H): a price
 * range, not a single price, built from clustered swing pivots that were tested more than once. */
export interface Zone {
  kind: 'support' | 'resistance'
  low: number
  high: number
  touches: number
  lastTouchIndex: number
}

/** `level`/`breakoutIndex` describe the zone edge the setup pivots on: for ZONE_REACTION it's the
 * candle that first touched the zone; for BREAKOUT_PULLBACK_RETEST it's the candle that broke it. */
export interface BreakoutInfo {
  direction: TradeDirection
  level: number
  breakoutIndex: number
  breakoutClose: number
}

/** `pullbackIndex` is the most recent candle — the one evaluated for rejection + reclaim. */
export interface PullbackInfo {
  confirmed: boolean
  pullbackIndex: number
  retestPrice: number
}

export interface ConfirmationInfo {
  /** The only mandatory gate: a rejection candle that closes back beyond the zone. */
  confirmed: boolean
  candlestickRejection: boolean
  reclaimClose: boolean
  /** Secondary/optional boosters — never gate a signal alone, only feed the quality score. */
  volumeConfirmed: boolean
  rsiConfirmed: boolean
  macdConfirmed: boolean
}

/** Result of the pure strategy engine: a candidate operational setup, or null (NO TRADE). */
export interface ScalpSetup {
  symbol: string
  direction: TradeDirection
  regime: MarketRegime
  setupType: SetupType
  zone: Zone
  breakout: BreakoutInfo
  pullback: PullbackInfo
  confirmation: ConfirmationInfo
  entryPrice: number
  stopCandidate: number
  atr: number
  atrPct: number
  rsi: number
  macdHistogram: number
  volumeRatio: number
  timestamp: number
}

export interface RiskCalc {
  valid: boolean
  reasonInvalid?: 'STOP_TOO_WIDE' | 'RR_TOO_LOW' | 'DAILY_LOCKED' | 'MAX_TRADES_REACHED'
  stopLoss: number
  stopDistance: number
  riskAmount: number
  rewardAmount: number
  positionSize: number
  takeProfit1: number
  takeProfit2: number
  riskRewardRatio: number
  capitalCurrency: Currency
}

export interface ConfidenceBreakdown {
  trendAlignment: number
  breakoutQuality: number
  pullbackQuality: number
  volume: number
  rsi: number
  macd: number
  volatility: number
  riskReward: number
  total: number
}

export type AlertType =
  | 'SETUP_DETECTED'
  | 'ENTRY_CONFIRMED'
  | 'EXIT_SUGGESTED'
  | 'STOP_HIT'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'SETUP_INVALIDATED'

export interface ExitSignalInfo {
  /** True once at least 2 of the 3 reversal signals below agree — a discretionary heads-up,
   * never an automatic close (the paper trade itself still only closes on STOP/TP). */
  suggested: boolean
  candlestickReversal: boolean
  rsiReversal: boolean
  macdReversal: boolean
}

export interface AlertEvent {
  id: string
  symbol: string
  timeframe: string
  type: AlertType
  state: SignalState
  direction: TradeDirection | null
  entryPrice?: number
  stopLoss?: number
  takeProfit1?: number
  takeProfit2?: number
  riskAmount?: number
  rewardAmount?: number
  riskRewardRatio?: number
  confidence?: number
  capitalCurrency?: Currency
  reasons: string[]
  timestamp: number
}

export interface DailyRiskStatus {
  locked: boolean
  reason?: string
  tradesToday: number
  lossRToday: number
  dayKey: string
}

export interface SignalSnapshot {
  symbol: string
  state: SignalState
  regime: MarketRegime
  setup: ScalpSetup | null
  risk: RiskCalc | null
  confidence: ConfidenceBreakdown | null
  dailyRisk: DailyRiskStatus
  lastAlert: AlertEvent | null
  /** Read-only market context (e.g. whale flow) — never drives state/score, display only. */
  whaleContext?: 'bullish' | 'bearish' | null
  updatedAt: number
}

export interface PaperTrade {
  id: string
  symbol: string
  direction: TradeDirection
  entryPrice: number
  stopLoss: number
  takeProfit1: number
  takeProfit2: number
  positionSize: number
  riskAmount: number
  confidence: number
  capitalCurrency: Currency
  openedAt: number
  closedAt?: number
  exitPrice?: number
  result: 'OPEN' | 'TP1' | 'TP2' | 'SL' | 'EXPIRED'
  pnl?: number
  pnlR?: number
  costPct: number
  /** Set once an EXIT_SUGGESTED alert has fired for this trade, so it never fires twice for the
   * same open position. */
  exitSuggested?: boolean
}

export interface PaperStats {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  profitFactor: number
  avgWin: number
  avgLoss: number
  expectancy: number
  maxDrawdown: number
  totalPnl: number
  avgRR: number
}
