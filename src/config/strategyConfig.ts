import type { Currency } from '../types/domain'

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
  trendTimeframe: string
  entryTimeframe: string
  emaFast: number
  emaMedium: number
  emaSlow: number
  rsiPeriod: number
  atrPeriod: number
  swingLookback: number
  pullbackMaxBars: number
  volumeConfirmMult: number
  maxStopAtr: number
  atrStopBufferMult: number
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
  trendTimeframe: '15m',
  entryTimeframe: '5m',
  emaFast: 20,
  emaMedium: 50,
  emaSlow: 200,
  rsiPeriod: 14,
  atrPeriod: 14,
  swingLookback: 20,
  pullbackMaxBars: 12,
  volumeConfirmMult: 1.2,
  maxStopAtr: 2.5,
  atrStopBufferMult: 0.25,
  capital: 92_000,
  capitalCurrency: 'chf',
  riskPerTradePct: 0.25,
  minRiskReward: 2.0,
  maxDailyLossR: 2,
  maxTradesPerDay: 3,
  minSignalConfidence: 70,
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

const STORAGE_KEY = 'csp_strategy_config_v1'

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
