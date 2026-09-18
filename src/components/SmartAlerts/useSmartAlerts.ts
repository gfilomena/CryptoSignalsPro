import { useCallback, useEffect, useState } from 'react'
import type { MetricSnapshot, SmartAlert, TriggeredAlertEvent } from '../../types/smartAlert'
import { hasSupabaseConfig } from '../../config/env'
import { listAlerts, listHistory, markHistoryRead, removeAlert, saveAlert, setAlertEnabled, deleteHistoryEvent } from '../../lib/smartAlerts/api'
import { runLocalAlertCycle } from '../../lib/smartAlerts/localEvaluator'
import { fetchSmartAlertSnapshot } from '../../lib/smartAlerts/marketData'

const POLL_MS = 30_000

export interface UseSmartAlerts {
  alerts: SmartAlert[]
  history: TriggeredAlertEvent[]
  /** Live market snapshot per distinct symbol among the loaded alerts — used for the "current
   * state of each monitored parameter" display on alert cards (spec §8). Best-effort only. */
  snapshots: Record<string, MetricSnapshot>
  loading: boolean
  saveAlert: (alert: SmartAlert) => Promise<void>
  deleteAlert: (id: string) => Promise<void>
  toggleAlert: (id: string, enabled: boolean) => Promise<void>
  markRead: (id: string) => Promise<void>
  deleteHistory: (id: string) => Promise<void>
}

/**
 * Loads and polls Smart Alerts state for the UI. When Supabase is configured, the
 * smart-alerts-cycle cron job is the source of truth (this hook just refreshes from it); when
 * it isn't, this hook itself runs the client-side evaluation fallback on the same cadence so the
 * feature still fully works locally (mirrors src/lib/scalp/signalClient.ts's fallback shape).
 */
export function useSmartAlerts(): UseSmartAlerts {
  const [alerts, setAlerts] = useState<SmartAlert[]>([])
  const [history, setHistory] = useState<TriggeredAlertEvent[]>([])
  const [snapshots, setSnapshots] = useState<Record<string, MetricSnapshot>>({})
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [nextAlerts, nextHistory] = await Promise.all([listAlerts(), listHistory()])
    setAlerts(nextAlerts)
    setHistory(nextHistory)
    return nextAlerts
  }, [])

  useEffect(() => {
    let cancelled = false

    async function tick() {
      try {
        const currentAlerts = await listAlerts()
        if (!hasSupabaseConfig) {
          // The local fallback evaluator fetches a snapshot per symbol anyway — reuse it for
          // display instead of fetching twice.
          const { snapshots: cycleSnapshots } = await runLocalAlertCycle(currentAlerts)
          if (!cancelled) setSnapshots(cycleSnapshots)
        } else {
          const symbols = Array.from(new Set(currentAlerts.filter((a) => a.enabled).map((a) => a.symbol)))
          const entries = await Promise.all(symbols.map(async (s) => [s, await fetchSmartAlertSnapshot(s)] as const))
          if (!cancelled) setSnapshots(Object.fromEntries(entries))
        }
      } catch {
        /* transient market-data failure — next tick will retry */
      }
      if (!cancelled) {
        await refresh()
        setLoading(false)
      }
    }

    tick()
    const id = setInterval(tick, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [refresh])

  const handleSaveAlert = useCallback(
    async (alert: SmartAlert) => {
      await saveAlert(alert)
      await refresh()
    },
    [refresh],
  )

  const handleDeleteAlert = useCallback(
    async (id: string) => {
      await removeAlert(id)
      await refresh()
    },
    [refresh],
  )

  const handleToggleAlert = useCallback(
    async (id: string, enabled: boolean) => {
      await setAlertEnabled(id, enabled)
      await refresh()
    },
    [refresh],
  )

  const handleMarkRead = useCallback(
    async (id: string) => {
      await markHistoryRead(id)
      await refresh()
    },
    [refresh],
  )

  const handleDeleteHistory = useCallback(
    async (id: string) => {
      await deleteHistoryEvent(id)
      await refresh()
    },
    [refresh],
  )

  return {
    alerts,
    history,
    snapshots,
    loading,
    saveAlert: handleSaveAlert,
    deleteAlert: handleDeleteAlert,
    toggleAlert: handleToggleAlert,
    markRead: handleMarkRead,
    deleteHistory: handleDeleteHistory,
  }
}
