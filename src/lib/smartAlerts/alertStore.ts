// Local (per-device) persistence for Smart Alerts — mirrors the localStorage pattern already used
// by src/config/strategyConfig.ts. This is always the UI's immediate source of truth (instant,
// no loading state); src/lib/smartAlerts/api.ts layers best-effort server sync on top of it,
// exactly like remoteConfig.ts does for the scalp engine's settings.
import type { SmartAlert, TriggeredAlertEvent } from '../../types/smartAlert'

const ALERTS_KEY = 'csp_smart_alerts_v1'
const HISTORY_KEY = 'csp_smart_alert_history_v1'
const MAX_HISTORY = 200

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota errors */
  }
}

export function listLocalAlerts(): SmartAlert[] {
  return readJson<SmartAlert[]>(ALERTS_KEY, [])
}

function saveLocalAlerts(alerts: SmartAlert[]): void {
  writeJson(ALERTS_KEY, alerts)
}

/** Insert or replace by id. */
export function upsertLocalAlert(alert: SmartAlert): SmartAlert[] {
  const existing = listLocalAlerts()
  const idx = existing.findIndex((a) => a.id === alert.id)
  const next = idx === -1 ? [alert, ...existing] : existing.map((a, i) => (i === idx ? alert : a))
  saveLocalAlerts(next)
  return next
}

export function deleteLocalAlert(id: string): SmartAlert[] {
  const next = listLocalAlerts().filter((a) => a.id !== id)
  saveLocalAlerts(next)
  return next
}

export function setLocalAlertEnabled(id: string, enabled: boolean): SmartAlert[] {
  const next = listLocalAlerts().map((a) => (a.id === id ? { ...a, enabled, sessionExpired: enabled ? false : a.sessionExpired } : a))
  saveLocalAlerts(next)
  return next
}

/** Auto-pauses any SESSION alert whose window has elapsed. Called on every read so the UI never
 * shows a stale "Active" badge for an expired session alert. */
export function expireLocalSessions(now: number): SmartAlert[] {
  const alerts = listLocalAlerts()
  let changed = false
  const next = alerts.map((a) => {
    if (a.mode === 'SESSION' && a.enabled && typeof a.expiresAt === 'number' && now >= a.expiresAt) {
      changed = true
      return { ...a, enabled: false, sessionExpired: true }
    }
    return a
  })
  if (changed) saveLocalAlerts(next)
  return next
}

export function recordLocalTrigger(id: string, timestamp: number): SmartAlert[] {
  const next = listLocalAlerts().map((a) => (a.id === id ? { ...a, lastTriggeredAt: timestamp } : a))
  saveLocalAlerts(next)
  return next
}

export function listLocalHistory(): TriggeredAlertEvent[] {
  return readJson<TriggeredAlertEvent[]>(HISTORY_KEY, [])
}

/** Dedupes by id (guards against the same trigger being recorded twice, e.g. a client fallback
 * evaluation racing a server-sourced event for the same alert). */
export function addLocalHistoryEvent(event: TriggeredAlertEvent): TriggeredAlertEvent[] {
  const existing = listLocalHistory()
  if (existing.some((e) => e.id === event.id)) return existing
  const next = [event, ...existing].slice(0, MAX_HISTORY)
  writeJson(HISTORY_KEY, next)
  return next
}

export function markLocalHistoryRead(id: string): TriggeredAlertEvent[] {
  const next = listLocalHistory().map((e) => (e.id === id ? { ...e, read: true } : e))
  writeJson(HISTORY_KEY, next)
  return next
}

export function deleteLocalHistoryEvent(id: string): TriggeredAlertEvent[] {
  const next = listLocalHistory().filter((e) => e.id !== id)
  writeJson(HISTORY_KEY, next)
  return next
}
