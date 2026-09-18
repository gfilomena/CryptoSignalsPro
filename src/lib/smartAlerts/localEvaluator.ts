// Client-side evaluation fallback: runs the same pure condition engine used server-side
// (smart-alerts-cycle) directly in the browser, for when Supabase isn't configured or as an
// interim UI signal before the cron job's push arrives. Mirrors the "server-preferred, local
// fallback" shape of src/lib/scalp/signalClient.ts's evaluateSymbolLocally.
import type { AlertCategory, MetricSnapshot, SmartAlert, TriggeredAlertEvent } from '../../types/smartAlert'
import { processAlert } from './conditionEngine'
import { fetchSmartAlertSnapshot } from './marketData'
import { buildPushPayload, toTriggeredEvent } from './notificationCopy'
import { recordHistoryEvent } from './api'
import { recordLocalTrigger } from './alertStore'
import { showLocalNotification } from './localPush'

/** Neutral monitoring copy per category — see spec §10/§17 (never "BUY"/"SELL"). Exported so the
 * UI can reuse identical wording when previewing an alert before it fires. */
export const CATEGORY_MESSAGES: Record<AlertCategory, string> = {
  PRICE: 'Price conditions detected',
  MOMENTUM: 'Momentum conditions detected',
  HIGH_LEVERAGE: 'High leverage conditions detected',
  FUNDING: 'Funding conditions detected',
  OPEN_INTEREST: 'Open interest conditions detected',
  LIQUIDATION: 'Liquidation activity increased',
  REVERSAL_WATCH: 'Reversal Watch triggered',
  OVERHEATED_MARKET: 'Overheated market conditions detected',
  MARKET_STRENGTH: 'Market strength conditions detected',
  CUSTOM: 'Custom alert triggered',
}

export interface LocalCycleResult {
  triggeredEvents: TriggeredAlertEvent[]
  snapshots: Record<string, MetricSnapshot>
}

/**
 * Evaluates every enabled, non-expired alert against a fresh market snapshot (one fetch per
 * distinct symbol, never duplicated per-alert), records any trigger to history + cooldown, and
 * fires a best-effort local notification. Returns the events so the caller can update UI state
 * immediately without re-reading storage.
 */
export async function runLocalAlertCycle(alerts: SmartAlert[], now = Date.now()): Promise<LocalCycleResult> {
  const active = alerts.filter((a) => a.enabled)
  const symbols = Array.from(new Set(active.map((a) => a.symbol)))

  const snapshotEntries = await Promise.all(
    symbols.map(async (symbol) => [symbol, await fetchSmartAlertSnapshot(symbol)] as const),
  )
  const snapshots = Object.fromEntries(snapshotEntries) as Record<string, MetricSnapshot>

  const triggeredEvents: TriggeredAlertEvent[] = []
  for (const alert of active) {
    const snapshot = snapshots[alert.symbol]
    if (!snapshot) continue
    const result = processAlert(alert, snapshot, now)
    if (!result.shouldFire) continue

    const event = toTriggeredEvent(alert, snapshot, result.evaluation.matchedConditions, now)
    await recordHistoryEvent(event)
    recordLocalTrigger(alert.id, now)
    triggeredEvents.push(event)

    if (alert.pushEnabled) {
      const payload = buildPushPayload(alert, snapshot, CATEGORY_MESSAGES[alert.category])
      void showLocalNotification(payload)
    }
  }

  return { triggeredEvents, snapshots }
}
