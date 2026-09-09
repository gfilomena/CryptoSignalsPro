import type { Currency } from '../types/domain'
import type { AlertType } from '../types/scalpSignal'

/** Alert types that trigger a push notification. SETUP_DETECTED is intentionally excluded — it's
 * recorded in the signal history for transparency but never worth interrupting the user for
 * (prudent mode: only real trade-affecting events push). */
export const PUSH_ALERT_TYPES: AlertType[] = [
  'ENTRY_CONFIRMED',
  'STOP_HIT',
  'TP1_HIT',
  'TP2_HIT',
  'SETUP_INVALIDATED',
]

export interface ScalpSymbolDef {
  symbol: string
  name: string
  pair: string
  enabled: boolean
}

export interface ConfidenceWeights {
  trendAlignment: number
  breakoutQuality: number
  pullbackQuality: number
  volume: number
  rsi: number
  macd: number
  volatility: number
  riskReward: number
}

export interface TradingCosts {
  feePct: number
  spreadPct: number
  slippagePct: number
}

export interface StrategyConfig {
  symbols: ScalpSymbolDef[]
  /** Market regime / main trend timeframe. */
  trendTimeframe: string
  /** Support/resistance structure timeframe — where significant zones are detected. */
  structureTimeframe: string
  /** Entry confirmation timeframe. */
  entryTimeframe: string
  emaFast: number
  emaMedium: number
  emaSlow: number
  /** Candles (trend timeframe) scanned for the higher-high/higher-low structure check. */
  structureSwingLookback: number
  rsiPeriod: number
  atrPeriod: number
  /** Candles (entry timeframe) averaged for the volume-confirmation baseline. */
  swingLookback: number
  /** Max entry-timeframe candles after a zone breakout to still count a pullback/retest as valid. */
  pullbackMaxBars: number
  volumeConfirmMult: number
  maxStopAtr: number
  atrStopBufferMult: number
  /** Structure-timeframe candles scanned for support/resistance zones. */
  zoneLookback: number
  /** Candles on each side required to confirm a swing pivot (structure timeframe). */
  zonePivotWindow: number
  /** Minimum number of times a zone must have been tested to count as significant. */
  zoneMinTouches: number
  /** Clustering tolerance for grouping nearby pivots into one zone, as % of price. */
  zoneClusterPct: number
  capital: number
  capitalCurrency: Currency
  riskPerTradePct: number
  minRiskReward: number
  maxDailyLossR: number
  maxTradesPerDay: number
  minSignalConfidence: number
  confidenceWeights: ConfidenceWeights
  alertCooldownMs: number
  tradingCosts: TradingCosts
}

/** Architecture is symbol-agnostic; only BTC/USDT is enabled today per spec. */
export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  symbols: [
    { symbol: 'BTC', name: 'Bitcoin', pair: 'BTCUSDT', enabled: true },
    { symbol: 'ETH', name: 'Ethereum', pair: 'ETHUSDT', enabled: false },
    { symbol: 'SOL', name: 'Solana', pair: 'SOLUSDT', enabled: false },
    { symbol: 'BNB', name: 'Binance Coin', pair: 'BNBUSDT', enabled: false },
  ],
  trendTimeframe: '4h',
  structureTimeframe: '1h',
  entryTimeframe: '15m',
  emaFast: 20,
  emaMedium: 50,
  emaSlow: 200,
  structureSwingLookback: 10,
  rsiPeriod: 14,
  atrPeriod: 14,
  swingLookback: 20,
  pullbackMaxBars: 8,
  volumeConfirmMult: 1.2,
  maxStopAtr: 2.5,
  atrStopBufferMult: 0.25,
  zoneLookback: 150,
  zonePivotWindow: 3,
  zoneMinTouches: 2,
  zoneClusterPct: 0.15,
  capital: 100_000,
  capitalCurrency: 'usd',
  riskPerTradePct: 1,
  minRiskReward: 2.0,
  maxDailyLossR: 2,
  maxTradesPerDay: 2,
  minSignalConfidence: 60,
  confidenceWeights: {
    trendAlignment: 25,
    breakoutQuality: 15,
    pullbackQuality: 15,
    volume: 10,
    rsi: 10,
    macd: 10,
    volatility: 10,
    riskReward: 5,
  },
  alertCooldownMs: 5 * 60_000,
  tradingCosts: {
    feePct: 0.04,
    spreadPct: 0.02,
    slippagePct: 0.02,
  },
}

// v2: prudent-mode restructuring (4h/1h/15m timeframes, zone-based structure, new risk defaults) —
// bumped so a browser with a v1 override never silently resurrects the old, looser defaults.
const STORAGE_KEY = 'csp_strategy_config_v2'

function mergeConfig(base: StrategyConfig, override: Partial<StrategyConfig>): StrategyConfig {
  return {
    ...base,
    ...override,
    confidenceWeights: { ...base.confidenceWeights, ...override.confidenceWeights },
    tradingCosts: { ...base.tradingCosts, ...override.tradingCosts },
    symbols: override.symbols ?? base.symbols,
  }
}

export function getStrategyConfig(): StrategyConfig {
  if (typeof localStorage === 'undefined') return DEFAULT_STRATEGY_CONFIG
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STRATEGY_CONFIG
    const parsed = JSON.parse(raw) as Partial<StrategyConfig>
    return mergeConfig(DEFAULT_STRATEGY_CONFIG, parsed)
  } catch {
    return DEFAULT_STRATEGY_CONFIG
  }
}

export function setStrategyConfig(patch: Partial<StrategyConfig>): StrategyConfig {
  const next = mergeConfig(getStrategyConfig(), patch)
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore quota errors */
    }
  }
  return next
}

export function resetStrategyConfig(): StrategyConfig {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
  return DEFAULT_STRATEGY_CONFIG
}
