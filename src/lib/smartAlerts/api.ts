// Server sync for Smart Alerts, layered on top of the always-available local store (see
// alertStore.ts). Writes are local-first/optimistic with a best-effort PostgREST push — the same
// pattern src/lib/scalp/remoteConfig.ts uses for scalp_config — so the UI never blocks on the
// network and the app keeps working with Supabase unconfigured (e.g. local dev). Reads for
// triggered-alert history prefer the server (it's the source of truth once the smart-alerts-cycle
// cron job is running) with a transparent fallback to the local cache, mirroring
// src/lib/scalp/signalClient.ts's getSignalData().
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseConfig } from '../../config/env'
import type { SmartAlert, TriggeredAlertEvent } from '../../types/smartAlert'
import {
  addLocalHistoryEvent,
  deleteLocalAlert,
  deleteLocalHistoryEvent,
  expireLocalSessions,
  listLocalAlerts,
  listLocalHistory,
  listSyncedIds,
  markSynced,
  unmarkSynced,
  markLocalHistoryRead,
  setLocalAlertEnabled,
  upsertLocalAlert,
} from './alertStore'

export function restUrl(path: string): string {
  return `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1${path}`
}

export function restHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

interface SmartAlertRow {
  id: string
  name: string
  category: string
  symbol: string
  mode: string
  session_duration: string | null
  enabled: boolean
  conditions: SmartAlert['conditions']
  operator: string
  cooldown_ms: number
  push_enabled: boolean
  created_at: string
  expires_at: string | null
  last_triggered_at: string | null
  session_expired: boolean
  confirmation_cycles: number
  pending_match_count: number
  last_invalidated_at: string | null
}

function toRow(alert: SmartAlert): SmartAlertRow {
  return {
    id: alert.id,
    name: alert.name,
    category: alert.category,
    symbol: alert.symbol,
    mode: alert.mode,
    session_duration: alert.sessionDuration ?? null,
    enabled: alert.enabled,
    conditions: alert.conditions,
    operator: alert.operator,
    cooldown_ms: alert.cooldownMs,
    push_enabled: alert.pushEnabled,
    created_at: new Date(alert.createdAt).toISOString(),
    expires_at: alert.expiresAt ? new Date(alert.expiresAt).toISOString() : null,
    last_triggered_at: alert.lastTriggeredAt ? new Date(alert.lastTriggeredAt).toISOString() : null,
    session_expired: alert.sessionExpired ?? false,
    confirmation_cycles: alert.confirmationCycles,
    pending_match_count: alert.pendingMatchCount,
    last_invalidated_at: alert.lastInvalidatedAt ? new Date(alert.lastInvalidatedAt).toISOString() : null,
  }
}

function fromRow(row: SmartAlertRow): SmartAlert {
  return {
    id: row.id,
    name: row.name,
    category: row.category as SmartAlert['category'],
    symbol: row.symbol,
    mode: row.mode as SmartAlert['mode'],
    sessionDuration: (row.session_duration as SmartAlert['sessionDuration']) ?? undefined,
    enabled: row.enabled,
    conditions: row.conditions,
    operator: row.operator as SmartAlert['operator'],
    cooldownMs: row.cooldown_ms,
    pushEnabled: row.push_enabled,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : undefined,
    lastTriggeredAt: row.last_triggered_at ? new Date(row.last_triggered_at).getTime() : undefined,
    sessionExpired: row.session_expired,
    confirmationCycles: row.confirmation_cycles ?? 1,
    pendingMatchCount: row.pending_match_count ?? 0,
    lastInvalidatedAt: row.last_invalidated_at ? new Date(row.last_invalidated_at).getTime() : undefined,
  }
}

/**
 * Returns the working alert list: server-synced when Supabase is configured and reachable
 * (server list wins so multiple devices/the cron job stay consistent), local cache otherwise.
 */
export async function listAlerts(now = Date.now()): Promise<SmartAlert[]> {
  const local = expireLocalSessions(now)
  if (!hasSupabaseConfig) return local

  try {
    const res = await fetch(restUrl('/smart_alerts?select=*&order=created_at.desc'), { headers: restHeaders() })
    if (!res.ok) return local
    const rows = (await res.json()) as SmartAlertRow[]
    const alerts = rows.map(fromRow)
    // The server is the source of truth for alerts it has confirmed: a synced alert that is now
    // missing was deleted elsewhere, so drop it. A local alert the server never confirmed (its
    // upsert failed) must NOT be dropped — that is how the essential alerts used to vanish — so
    // retry pushing it instead.
    const serverIds = new Set(alerts.map((a) => a.id))
    const synced = listSyncedIds()
    const unsynced: SmartAlert[] = []
    for (const local of listLocalAlerts()) {
      if (serverIds.has(local.id)) continue
      if (synced.has(local.id)) {
        deleteLocalAlert(local.id)
        unmarkSynced(local.id)
      } else {
        unsynced.push(local)
      }
    }
    for (const alert of alerts) upsertLocalAlert(alert)
    markSynced(alerts.map((a) => a.id))
    await Promise.all(unsynced.map(pushAlertToServer))
    return expireLocalSessions(now)
  } catch {
    return local
  }
}

/** Best-effort upsert; marks the alert as server-confirmed only on a 2xx, so a failed sync is retried
 * by the next listAlerts instead of being mistaken for a deletion. */
async function pushAlertToServer(alert: SmartAlert): Promise<void> {
  if (!hasSupabaseConfig) return
  try {
    const res = await fetch(restUrl('/smart_alerts?on_conflict=id'), {
      method: 'POST',
      headers: restHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(toRow(alert)),
    })
    if (res.ok) markSynced([alert.id])
  } catch {
    /* best-effort only — local store already has it */
  }
}

export async function saveAlert(alert: SmartAlert): Promise<SmartAlert[]> {
  const alerts = upsertLocalAlert(alert)
  await pushAlertToServer(alert)
  return alerts
}

export async function removeAlert(id: string): Promise<SmartAlert[]> {
  const alerts = deleteLocalAlert(id)
  unmarkSynced(id)
  if (hasSupabaseConfig) {
    try {
      await fetch(restUrl(`/smart_alerts?id=eq.${id}`), { method: 'DELETE', headers: restHeaders() })
    } catch {
      /* best-effort */
    }
  }
  return alerts
}

export async function setAlertEnabled(id: string, enabled: boolean): Promise<SmartAlert[]> {
  const alerts = setLocalAlertEnabled(id, enabled)
  if (hasSupabaseConfig) {
    try {
      await fetch(restUrl(`/smart_alerts?id=eq.${id}`), {
        method: 'PATCH',
        headers: restHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ enabled, session_expired: enabled ? false : undefined }),
      })
    } catch {
      /* best-effort */
    }
  }
  return alerts
}

interface HistoryRow {
  id: string
  alert_id: string
  alert_name: string
  category: string
  symbol: string
  kind: TriggeredAlertEvent['kind'] | null
  matched_conditions: TriggeredAlertEvent['matchedConditions']
  snapshot: TriggeredAlertEvent['snapshot']
  created_at: string
  read: boolean
}

function historyFromRow(row: HistoryRow): TriggeredAlertEvent {
  return {
    id: row.id,
    alertId: row.alert_id,
    alertName: row.alert_name,
    category: row.category as TriggeredAlertEvent['category'],
    symbol: row.symbol,
    // Rows created before invalidation tracking existed have no `kind` column value yet.
    kind: row.kind ?? 'triggered',
    matchedConditions: row.matched_conditions,
    snapshot: row.snapshot,
    timestamp: new Date(row.created_at).getTime(),
    read: row.read,
  }
}

/** Triggered-alert history: prefers the server (it also holds events fired by the cron job while
 * the app was closed) and falls back to the local cache when Supabase isn't reachable. */
export async function listHistory(limit = 100): Promise<TriggeredAlertEvent[]> {
  if (hasSupabaseConfig) {
    try {
      const res = await fetch(restUrl(`/smart_alert_events?select=*&order=created_at.desc&limit=${limit}`), { headers: restHeaders() })
      if (res.ok) {
        const rows = (await res.json()) as HistoryRow[]
        return rows.map(historyFromRow)
      }
    } catch {
      /* fall through to local */
    }
  }
  return listLocalHistory().slice(0, limit)
}

export async function recordHistoryEvent(event: TriggeredAlertEvent): Promise<TriggeredAlertEvent[]> {
  return addLocalHistoryEvent(event)
}

export async function markHistoryRead(id: string): Promise<TriggeredAlertEvent[]> {
  const events = markLocalHistoryRead(id)
  if (hasSupabaseConfig) {
    try {
      await fetch(restUrl(`/smart_alert_events?id=eq.${id}`), {
        method: 'PATCH',
        headers: restHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ read: true }),
      })
    } catch {
      /* best-effort */
    }
  }
  return events
}

export async function deleteHistoryEvent(id: string): Promise<TriggeredAlertEvent[]> {
  const events = deleteLocalHistoryEvent(id)
  if (hasSupabaseConfig) {
    try {
      await fetch(restUrl(`/smart_alert_events?id=eq.${id}`), { method: 'DELETE', headers: restHeaders() })
    } catch {
      /* best-effort */
    }
  }
  return events
}
