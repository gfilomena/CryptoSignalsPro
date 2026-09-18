import type { AlertCategory, MetricSnapshot, SmartAlert, TriggeredAlertEvent } from '../../types/smartAlert'

/** Neutral, informational monitoring language keyed by category — never "BUY"/"SELL"/"execute
 * trade". These map to i18n keys smartAlerts.categoryMessage.<category> in the message files. */
export const CATEGORY_MESSAGE_KEY: Record<AlertCategory, string> = {
  PRICE: 'PRICE',
  MOMENTUM: 'MOMENTUM',
  HIGH_LEVERAGE: 'HIGH_LEVERAGE',
  FUNDING: 'FUNDING',
  OPEN_INTEREST: 'OPEN_INTEREST',
  LIQUIDATION: 'LIQUIDATION',
  REVERSAL_WATCH: 'REVERSAL_WATCH',
  OVERHEATED_MARKET: 'OVERHEATED_MARKET',
  MARKET_STRENGTH: 'MARKET_STRENGTH',
  CUSTOM: 'CUSTOM',
}

function fmtPrice(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 4 : 2 })
}

function fmtPct(v: number): string {
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

/** Plain-text metric lines used both in the push notification body and the history detail view
 * (e.g. "Price: $81,240", "OI 15m: +1.43%", "Funding: +0.0081%"). Never a trade instruction. */
export function buildMetricLines(snapshot: MetricSnapshot): string[] {
  const lines: string[] = []
  if (snapshot.price !== null) lines.push(`Price: $${fmtPrice(snapshot.price)}`)
  if (snapshot.priceChangePct !== null) lines.push(`Price change: ${fmtPct(snapshot.priceChangePct)}`)
  for (const [tf, v] of Object.entries(snapshot.openInterestChangePct)) {
    if (v !== null && v !== undefined) lines.push(`OI ${tf}: ${fmtPct(v)}`)
  }
  if (snapshot.fundingRate !== null) lines.push(`Funding: ${fmtPct(snapshot.fundingRate)}`)
  for (const [tf, v] of Object.entries(snapshot.rsi)) {
    if (v !== null && v !== undefined) lines.push(`RSI ${tf}: ${v.toFixed(0)}`)
  }
  return lines
}

export interface PushPayload {
  title: string
  body: string
  type: 'SMART_ALERT'
  symbol: string
  alertId: string
  category: AlertCategory
}

/**
 * Builds the Web Push payload for a triggered Smart Alert. Deliberately neutral/monitoring
 * language ("Reversal Watch triggered", never "SELL BTC") — see spec section 10.
 */
export function buildPushPayload(alert: SmartAlert, snapshot: MetricSnapshot, categoryMessage: string): PushPayload {
  const title = `${alert.symbol}/USDT — ${alert.name}`
  const lines = buildMetricLines(snapshot)
  const body = [categoryMessage, ...lines].join('\n')
  return { title, body, type: 'SMART_ALERT', symbol: alert.symbol, alertId: alert.id, category: alert.category }
}

export function toTriggeredEvent(alert: SmartAlert, snapshot: MetricSnapshot, matched: SmartAlert['conditions'], now: number): TriggeredAlertEvent {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `evt-${alert.id}-${now}-${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    alertId: alert.id,
    alertName: alert.name,
    category: alert.category,
    symbol: alert.symbol,
    matchedConditions: matched,
    snapshot,
    timestamp: now,
    read: false,
  }
}
