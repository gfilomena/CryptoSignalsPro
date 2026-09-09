import type { PaperStats, PaperTrade, RiskCalc, ScalpSetup } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

/**
 * Opens a virtual (paper) trade mirroring a CONFIRMED setup. Costs (fee + spread + slippage,
 * from config) are snapshotted at open time so a later config change never retroactively
 * changes a past trade's economics.
 */
export function openPaperTrade(
  id: string,
  setup: ScalpSetup,
  risk: RiskCalc,
  confidence: number,
  config: StrategyConfig,
  openedAt: number,
): PaperTrade {
  const costs = config.tradingCosts
  const costPct = costs.feePct * 2 + costs.spreadPct + costs.slippagePct

  return {
    id,
    symbol: setup.symbol,
    direction: setup.direction,
    entryPrice: setup.entryPrice,
    stopLoss: risk.stopLoss,
    takeProfit1: risk.takeProfit1,
    takeProfit2: risk.takeProfit2,
    positionSize: risk.positionSize,
    riskAmount: risk.riskAmount,
    confidence,
    capitalCurrency: risk.capitalCurrency,
    openedAt,
    result: 'OPEN',
    costPct,
  }
}

/**
 * Closes a paper trade at the given exit price/reason, applying the round-trip cost snapshotted
 * at open and converting the USD-denominated price move back into the trade's capital currency.
 */
export function closePaperTrade(
  trade: PaperTrade,
  exitPrice: number,
  result: 'TP1' | 'TP2' | 'SL' | 'EXPIRED',
  closedAt: number,
  usdRate = 1,
): PaperTrade {
  const grossMoveUsd = trade.direction === 'long' ? exitPrice - trade.entryPrice : trade.entryPrice - exitPrice
  const grossPnlUsd = grossMoveUsd * trade.positionSize
  const notionalUsd = trade.entryPrice * trade.positionSize
  const costUsd = notionalUsd * (trade.costPct / 100)
  const netPnlUsd = grossPnlUsd - costUsd
  const pnl = netPnlUsd * usdRate
  const pnlR = trade.riskAmount > 0 ? pnl / trade.riskAmount : 0

  return { ...trade, closedAt, exitPrice, result, pnl, pnlR }
}

export function computePaperStats(trades: PaperTrade[]): PaperStats {
  const closed = trades.filter((t) => t.result !== 'OPEN')
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0)
  const losses = closed.filter((t) => (t.pnl ?? 0) <= 0)

  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const grossWin = wins.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0))

  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0
  const avgWin = wins.length ? grossWin / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : 0
  const expectancy = closed.length ? totalPnl / closed.length : 0
  const avgRR = closed.length ? closed.reduce((s, t) => s + (t.pnlR ?? 0), 0) / closed.length : 0

  const ordered = [...closed].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))
  let equity = 0
  let peak = 0
  let maxDrawdown = 0
  for (const t of ordered) {
    equity += t.pnl ?? 0
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
    avgWin,
    avgLoss,
    expectancy,
    maxDrawdown,
    totalPnl,
    avgRR,
  }
}
