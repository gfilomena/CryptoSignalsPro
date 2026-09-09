import type { MarketRegime, RiskCalc, ScalpSetup, SignalState, TradeDirection } from '../../types/scalpSignal'

export interface ActiveTradeLevels {
  direction: TradeDirection
  stopLoss: number
  takeProfit1: number
  takeProfit2: number
}

export interface StateMachineContext {
  prevState: SignalState
  regime: MarketRegime
  setup: ScalpSetup | null
  risk: RiskCalc | null
  confidenceTotal: number
  minConfidence: number
  /** Set once a paper trade is open for this symbol; drives STOP_HIT/TARGET_HIT detection. */
  activeTrade: ActiveTradeLevels | null
  currentPrice: number
}

const SETUP_OR_CONFIRMED_STATES: SignalState[] = ['LONG_SETUP', 'LONG_CONFIRMED', 'SHORT_SETUP', 'SHORT_CONFIRMED']

/**
 * Pure state transition: NO_TRADE/WATCH/LONG_SETUP/LONG_CONFIRMED/SHORT_SETUP/SHORT_CONFIRMED/
 * TRADE_ACTIVE/TARGET_HIT/STOP_HIT/EXPIRED. A setup only becomes *_CONFIRMED when its
 * confirmation is complete, the risk engine accepted it, and the confidence score clears the
 * configured threshold — otherwise it stays a *_SETUP (visible but not tradable).
 */
export function nextSignalState(ctx: StateMachineContext): SignalState {
  if (ctx.activeTrade) {
    const { direction, stopLoss, takeProfit1, takeProfit2 } = ctx.activeTrade
    const price = ctx.currentPrice
    const hitStop = direction === 'long' ? price <= stopLoss : price >= stopLoss
    if (hitStop) return 'STOP_HIT'
    const hitTarget =
      direction === 'long' ? price >= takeProfit1 || price >= takeProfit2 : price <= takeProfit1 || price <= takeProfit2
    if (hitTarget) return 'TARGET_HIT'
    return 'TRADE_ACTIVE'
  }

  if (!ctx.setup) {
    if (SETUP_OR_CONFIRMED_STATES.includes(ctx.prevState)) return 'EXPIRED'
    return ctx.regime === 'neutral' ? 'NO_TRADE' : 'WATCH'
  }

  const tradable = ctx.setup.confirmation.confirmed && !!ctx.risk?.valid && ctx.confidenceTotal >= ctx.minConfidence
  if (ctx.setup.direction === 'long') return tradable ? 'LONG_CONFIRMED' : 'LONG_SETUP'
  return tradable ? 'SHORT_CONFIRMED' : 'SHORT_SETUP'
}

export function directionOfState(state: SignalState): TradeDirection | null {
  if (state === 'LONG_SETUP' || state === 'LONG_CONFIRMED') return 'long'
  if (state === 'SHORT_SETUP' || state === 'SHORT_CONFIRMED') return 'short'
  return null
}
