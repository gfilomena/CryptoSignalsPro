import type { Currency } from './domain'

export type MarketRegime = 'bullish' | 'bearish' | 'neutral'
export type TradeDirection = 'long' | 'short'

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

export interface BreakoutInfo {
  direction: TradeDirection
  level: number
  breakoutIndex: number
  breakoutClose: number
}

export interface PullbackInfo {
  confirmed: boolean
  pullbackIndex: number
  retestPrice: number
}

export interface ConfirmationInfo {
  confirmed: boolean
  candlestickRejection: boolean
  volumeConfirmed: boolean
  rsiConfirmed: boolean
  macdConfirmed: boolean
}

/** Result of the pure strategy engine: a candidate operational setup, or null (NO TRADE). */
export interface ScalpSetup {
  symbol: string
  direction: TradeDirection
  regime: MarketRegime
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
  | 'STOP_HIT'
  | 'TP1_HIT'
  | 'TP2_HIT'
  | 'SETUP_INVALIDATED'

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
