import type { DailyRiskStatus, RiskCalc, ScalpSetup } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

function invalidResult(reason: RiskCalc['reasonInvalid'], config: StrategyConfig): RiskCalc {
  return {
    valid: false,
    reasonInvalid: reason,
    stopLoss: 0,
    stopDistance: 0,
    riskAmount: 0,
    rewardAmount: 0,
    positionSize: 0,
    takeProfit1: 0,
    takeProfit2: 0,
    riskRewardRatio: 0,
    capitalCurrency: config.capitalCurrency,
  }
}

/**
 * Computes stop/target/size for a candidate setup. Stop = swing extreme of the pullback leg
 * plus a small configurable ATR buffer; if the resulting distance is wider than MAX_STOP_ATR
 * (relative to volatility) the trade is rejected outright — no forcing a trade into an
 * unreasonable stop. Position size is derived purely from the fixed risk amount so that a stop
 * hit never loses more than riskAmount.
 *
 * `usdRate` converts the configured capital (which may be in USD/EUR/CHF) into the quote
 * currency of `setup.entryPrice` (Binance *USDT pairs, i.e. USD): units of capitalCurrency per
 * 1 USD. Pass 1 when capital is already in USD.
 */
export function calculateRisk(
  setup: ScalpSetup,
  config: StrategyConfig,
  dailyRisk: DailyRiskStatus,
  usdRate = 1,
): RiskCalc {
  if (dailyRisk.locked) return invalidResult('DAILY_LOCKED', config)
  if (dailyRisk.tradesToday >= config.maxTradesPerDay) return invalidResult('MAX_TRADES_REACHED', config)
  if (config.minRiskReward < 1) return invalidResult('RR_TOO_LOW', config)

  const rawStopDistance =
    setup.direction === 'long' ? setup.entryPrice - setup.stopCandidate : setup.stopCandidate - setup.entryPrice
  const atrBuffer = setup.atr * config.atrStopBufferMult
  const stopDistance = Math.max(rawStopDistance, 0) + atrBuffer

  if (stopDistance <= 0 || (setup.atr > 0 && stopDistance > setup.atr * config.maxStopAtr)) {
    return invalidResult('STOP_TOO_WIDE', config)
  }

  const stopLoss = setup.direction === 'long' ? setup.entryPrice - stopDistance : setup.entryPrice + stopDistance

  const riskAmount = config.capital * (config.riskPerTradePct / 100)
  const riskAmountUsd = usdRate > 0 ? riskAmount / usdRate : riskAmount
  const positionSize = riskAmountUsd / stopDistance
  const riskRewardRatio = config.minRiskReward
  const rewardAmount = riskAmount * riskRewardRatio

  const takeProfit1 =
    setup.direction === 'long' ? setup.entryPrice + stopDistance * riskRewardRatio : setup.entryPrice - stopDistance * riskRewardRatio
  const takeProfit2 =
    setup.direction === 'long'
      ? setup.entryPrice + stopDistance * (riskRewardRatio + 1)
      : setup.entryPrice - stopDistance * (riskRewardRatio + 1)

  return {
    valid: true,
    stopLoss,
    stopDistance,
    riskAmount,
    rewardAmount,
    positionSize,
    takeProfit1,
    takeProfit2,
    riskRewardRatio,
    capitalCurrency: config.capitalCurrency,
  }
}

export function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function initialDailyRisk(dayKey = todayKey()): DailyRiskStatus {
  return { locked: false, tradesToday: 0, lossRToday: 0, dayKey }
}

/** Rolls the daily counters forward on a new UTC day, and re-evaluates the lock. */
export function updateDailyRisk(
  prev: DailyRiskStatus,
  config: StrategyConfig,
  event: { newTrade?: boolean; closedLossR?: number },
): DailyRiskStatus {
  const dayKey = todayKey()
  let next = prev.dayKey === dayKey ? { ...prev } : initialDailyRisk(dayKey)

  if (event.newTrade) next.tradesToday += 1
  if (typeof event.closedLossR === 'number' && event.closedLossR < 0) {
    next.lossRToday += Math.abs(event.closedLossR)
  }

  const locked = next.lossRToday >= config.maxDailyLossR || next.tradesToday >= config.maxTradesPerDay
  next = { ...next, locked, reason: locked ? (next.lossRToday >= config.maxDailyLossR ? 'max_daily_loss' : 'max_trades') : undefined }
  return next
}
