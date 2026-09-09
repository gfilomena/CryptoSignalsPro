import type { AlertEvent, AlertType, ConfidenceBreakdown, RiskCalc, ScalpSetup, SignalState, TradeDirection } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

export interface AlertBuildContext {
  symbol: string
  timeframe: string
  prevState: SignalState
  nextState: SignalState
  setup: ScalpSetup | null
  risk: RiskCalc | null
  confidence: ConfidenceBreakdown | null
  reasons: string[]
  /** Which target was hit, when nextState === 'TARGET_HIT'. */
  targetHit?: 'TP1' | 'TP2'
  lastAlert: AlertEvent | null
  now: number
  config: StrategyConfig
}

function mapTransitionToAlertType(prev: SignalState, next: SignalState, targetHit?: 'TP1' | 'TP2'): AlertType | null {
  const wasSetupLike = prev === 'LONG_SETUP' || prev === 'SHORT_SETUP'
  const wasConfirmedLike = prev === 'LONG_CONFIRMED' || prev === 'SHORT_CONFIRMED'
  const wasActiveLike = prev === 'LONG_SETUP' || prev === 'LONG_CONFIRMED' || prev === 'SHORT_SETUP' || prev === 'SHORT_CONFIRMED'

  if ((next === 'LONG_SETUP' || next === 'SHORT_SETUP') && !wasActiveLike) return 'SETUP_DETECTED'
  if ((next === 'LONG_CONFIRMED' || next === 'SHORT_CONFIRMED') && (wasSetupLike || !wasActiveLike)) return 'ENTRY_CONFIRMED'
  if (next === 'STOP_HIT' && prev !== 'STOP_HIT') return 'STOP_HIT'
  if (next === 'TARGET_HIT' && prev !== 'TARGET_HIT') return targetHit === 'TP2' ? 'TP2_HIT' : 'TP1_HIT'
  if (next === 'EXPIRED' && (wasSetupLike || wasConfirmedLike)) return 'SETUP_INVALIDATED'
  return null
}

/**
 * Generates an AlertEvent only when the signal state actually changed AND the mapped alert
 * type isn't within its cooldown window for this symbol/timeframe — never on every refresh.
 */
export function buildAlert(ctx: AlertBuildContext): AlertEvent | null {
  if (ctx.prevState === ctx.nextState) return null

  const type = mapTransitionToAlertType(ctx.prevState, ctx.nextState, ctx.targetHit)
  if (!type) return null

  if (
    ctx.lastAlert &&
    ctx.lastAlert.type === type &&
    ctx.lastAlert.symbol === ctx.symbol &&
    ctx.now - ctx.lastAlert.timestamp < ctx.config.alertCooldownMs
  ) {
    return null
  }

  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${ctx.symbol}-${type}-${ctx.now}-${Math.random().toString(36).slice(2, 8)}`

  return {
    id,
    symbol: ctx.symbol,
    timeframe: ctx.timeframe,
    type,
    state: ctx.nextState,
    direction: ctx.setup?.direction ?? null,
    entryPrice: ctx.setup?.entryPrice,
    stopLoss: ctx.risk?.valid ? ctx.risk.stopLoss : undefined,
    takeProfit1: ctx.risk?.valid ? ctx.risk.takeProfit1 : undefined,
    takeProfit2: ctx.risk?.valid ? ctx.risk.takeProfit2 : undefined,
    riskAmount: ctx.risk?.valid ? ctx.risk.riskAmount : undefined,
    rewardAmount: ctx.risk?.valid ? ctx.risk.rewardAmount : undefined,
    riskRewardRatio: ctx.risk?.valid ? ctx.risk.riskRewardRatio : undefined,
    confidence: ctx.confidence?.total,
    capitalCurrency: ctx.risk?.capitalCurrency,
    reasons: ctx.reasons,
    timestamp: ctx.now,
  }
}

export interface ExitSuggestionContext {
  symbol: string
  timeframe: string
  direction: TradeDirection
  entryPrice: number
  stopLoss: number
  takeProfit1: number
  takeProfit2: number
  reasons: string[]
  now: number
}

/**
 * EXIT_SUGGESTED doesn't fit the state-transition model above (the signal STATE stays
 * TRADE_ACTIVE the whole time) — the caller is responsible for firing this at most once per open
 * trade (tracked via PaperTrade.exitSuggested) so it never fires the same trade twice.
 */
export function buildExitSuggestionAlert(ctx: ExitSuggestionContext): AlertEvent {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${ctx.symbol}-EXIT_SUGGESTED-${ctx.now}-${Math.random().toString(36).slice(2, 8)}`

  return {
    id,
    symbol: ctx.symbol,
    timeframe: ctx.timeframe,
    type: 'EXIT_SUGGESTED',
    state: 'TRADE_ACTIVE',
    direction: ctx.direction,
    entryPrice: ctx.entryPrice,
    stopLoss: ctx.stopLoss,
    takeProfit1: ctx.takeProfit1,
    takeProfit2: ctx.takeProfit2,
    reasons: ctx.reasons,
    timestamp: ctx.now,
  }
}
