// Smart Alerts: multi-indicator market-condition monitoring (not automated trading, not a
// buy/sell recommendation). An alert fires when its conditions match; it never places orders.

/** Market parameters a condition can watch. Mirrors the metrics actually available (or
 * documented as unavailable, see marketData.ts) from Binance for BTC/USDT-style futures pairs. */
export type AlertMetric =
  | 'PRICE'
  | 'PRICE_CHANGE'
  | 'OPEN_INTEREST'
  | 'OPEN_INTEREST_CHANGE'
  | 'FUNDING_RATE'
  | 'VOLUME'
  | 'VOLUME_CHANGE'
  | 'RSI'
  | 'LONG_LIQUIDATIONS'
  | 'SHORT_LIQUIDATIONS'
  | 'LIQUIDATION_SPIKE'

export type ConditionOperator = '>' | '>=' | '<' | '<=' | '=='

/** Lookback window for the metrics that need one (OI change, RSI, volume change). */
export type MetricTimeframe = '5m' | '15m' | '1h' | '4h'

export const METRIC_TIMEFRAMES: MetricTimeframe[] = ['5m', '15m', '1h', '4h']

/** Metrics that require picking a timeframe. Everything else is "current value", timeframe-less. */
export const TIMEFRAME_METRICS: AlertMetric[] = ['OPEN_INTEREST_CHANGE', 'RSI', 'VOLUME_CHANGE']

export interface AlertCondition {
  id: string
  metric: AlertMetric
  /** Required only for metrics in TIMEFRAME_METRICS. */
  timeframe?: MetricTimeframe
  operator: ConditionOperator
  /** Threshold value. For *_CHANGE / RSI / FUNDING_RATE this is a plain number (already a %
   * where relevant, e.g. -0.5 means -0.5%); for PRICE/VOLUME/OPEN_INTEREST it's an absolute value. */
  threshold: number
  enabled: boolean
}

export type LogicalOperator = 'AND' | 'OR'

export type AlertMode = 'ALWAYS' | 'SESSION'

export type SessionDuration = '30m' | '1h' | '2h' | '4h' | 'EOD'

export const SESSION_DURATION_MS: Record<Exclude<SessionDuration, 'EOD'>, number> = {
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
}

export type CooldownMs = 5 | 15 | 30 | 60 | 240 // minutes, kept as a plain number of minutes in UI

export const COOLDOWN_OPTIONS_MIN: number[] = [5, 15, 30, 60, 240]

/** Informational monitoring categories — never "BUY"/"SELL". */
export type AlertCategory =
  | 'PRICE'
  | 'MOMENTUM'
  | 'HIGH_LEVERAGE'
  | 'FUNDING'
  | 'OPEN_INTEREST'
  | 'LIQUIDATION'
  | 'REVERSAL_WATCH'
  | 'OVERHEATED_MARKET'
  | 'MARKET_STRENGTH'
  | 'CUSTOM'

export interface SmartAlert {
  id: string
  name: string
  category: AlertCategory
  /** Base asset, e.g. "BTC" — paired with USDT for market data lookups. */
  symbol: string
  mode: AlertMode
  sessionDuration?: SessionDuration
  enabled: boolean
  conditions: AlertCondition[]
  operator: LogicalOperator
  /** Minimum time between two triggers of this alert, in milliseconds. */
  cooldownMs: number
  pushEnabled: boolean
  createdAt: number
  /** Only set when mode === 'SESSION'; the alert is treated as expired (and shown paused) past this. */
  expiresAt?: number
  lastTriggeredAt?: number
  /** True once a SESSION alert's window has elapsed and it was auto-disabled. */
  sessionExpired?: boolean
}

/** A snapshot of every metric value a condition might reference, at one point in time. A value
 * of `null` means that metric could not be fetched (missing/unsupported data, API error) —
 * conditions referencing it are treated as "cannot evaluate", never as silently false-negative. */
export interface MetricSnapshot {
  symbol: string
  timestamp: number
  price: number | null
  priceChangePct: number | null
  openInterest: number | null
  openInterestChangePct: Partial<Record<MetricTimeframe, number | null>>
  fundingRate: number | null
  volume: number | null
  volumeChangePct: Partial<Record<MetricTimeframe, number | null>>
  rsi: Partial<Record<MetricTimeframe, number | null>>
  longLiquidations: number | null
  shortLiquidations: number | null
  liquidationSpike: boolean | null
}

/** Result of matching one alert against a snapshot. */
export interface AlertEvaluation {
  triggered: boolean
  matchedConditions: AlertCondition[]
  /** Conditions that could not be evaluated because their metric was unavailable in the snapshot. */
  unavailableConditions: AlertCondition[]
}

/** A record of an alert having actually fired (for the "Triggered Alerts" / History section). */
export interface TriggeredAlertEvent {
  id: string
  alertId: string
  alertName: string
  category: AlertCategory
  symbol: string
  matchedConditions: AlertCondition[]
  snapshot: MetricSnapshot
  timestamp: number
  read: boolean
}
