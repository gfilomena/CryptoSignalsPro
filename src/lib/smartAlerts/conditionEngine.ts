import type {
  AlertCondition,
  AlertEvaluation,
  MetricSnapshot,
  SessionDuration,
  SmartAlert,
} from '../../types/smartAlert'
import { SESSION_DURATION_MS } from '../../types/smartAlert'

/** Reads the raw value a condition refers to out of a snapshot. `null` = unavailable data. */
export function readMetricValue(condition: AlertCondition, snapshot: MetricSnapshot): number | null {
  switch (condition.metric) {
    case 'PRICE':
      return snapshot.price
    case 'PRICE_CHANGE':
      return snapshot.priceChangePct
    case 'OPEN_INTEREST':
      return snapshot.openInterest
    case 'OPEN_INTEREST_CHANGE':
      return condition.timeframe ? (snapshot.openInterestChangePct[condition.timeframe] ?? null) : null
    case 'FUNDING_RATE':
      return snapshot.fundingRate
    case 'VOLUME':
      return snapshot.volume
    case 'VOLUME_CHANGE':
      return condition.timeframe ? (snapshot.volumeChangePct[condition.timeframe] ?? null) : null
    case 'RSI':
      return condition.timeframe ? (snapshot.rsi[condition.timeframe] ?? null) : null
    case 'LONG_LIQUIDATIONS':
      return snapshot.longLiquidations
    case 'SHORT_LIQUIDATIONS':
      return snapshot.shortLiquidations
    case 'LIQUIDATION_SPIKE':
      return snapshot.liquidationSpike === null ? null : snapshot.liquidationSpike ? 1 : 0
    default:
      return null
  }
}

function compare(value: number, operator: AlertCondition['operator'], threshold: number): boolean {
  switch (operator) {
    case '>':
      return value > threshold
    case '>=':
      return value >= threshold
    case '<':
      return value < threshold
    case '<=':
      return value <= threshold
    case '==':
      return value === threshold
    default:
      return false
  }
}

/** `null` = the condition's metric was unavailable in this snapshot, so it can't be evaluated
 * (never silently treated as a match or a non-match — callers decide how to fold that into AND/OR). */
export function evaluateCondition(condition: AlertCondition, snapshot: MetricSnapshot): boolean | null {
  if (!Number.isFinite(condition.threshold)) return null
  const value = readMetricValue(condition, snapshot)
  if (value === null || !Number.isFinite(value)) return null
  return compare(value, condition.operator, condition.threshold)
}

/**
 * Combines all enabled conditions with the alert's logical operator.
 * - AND: every enabled condition must be available AND true. One unavailable condition means the
 *   rule can't be confirmed, so the alert does not trigger (fails closed, never spuriously fires).
 * - OR: any available condition being true triggers the alert; unavailable conditions are simply
 *   skipped rather than blocking the others.
 */
export function evaluateAlert(alert: SmartAlert, snapshot: MetricSnapshot): AlertEvaluation {
  const enabled = alert.conditions.filter((c) => c.enabled)
  if (enabled.length === 0) return { triggered: false, matchedConditions: [], unavailableConditions: [] }

  const matched: AlertCondition[] = []
  const unavailable: AlertCondition[] = []
  for (const condition of enabled) {
    const result = evaluateCondition(condition, snapshot)
    if (result === null) unavailable.push(condition)
    else if (result) matched.push(condition)
  }

  const triggered =
    alert.operator === 'AND' ? unavailable.length === 0 && matched.length === enabled.length : matched.length > 0

  return { triggered, matchedConditions: matched, unavailableConditions: unavailable }
}

export function isInCooldown(alert: SmartAlert, now: number): boolean {
  if (!alert.lastTriggeredAt) return false
  return now - alert.lastTriggeredAt < alert.cooldownMs
}

export function isSessionExpired(alert: SmartAlert, now: number): boolean {
  return alert.mode === 'SESSION' && typeof alert.expiresAt === 'number' && now >= alert.expiresAt
}

/** End-of-day is midnight in the caller's local timezone. */
function endOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function computeExpiresAt(mode: 'ALWAYS' | 'SESSION', sessionDuration: SessionDuration | undefined, now: number): number | undefined {
  if (mode !== 'SESSION' || !sessionDuration) return undefined
  if (sessionDuration === 'EOD') return endOfDay(now)
  return now + SESSION_DURATION_MS[sessionDuration]
}

export function isInvalidationCooldown(alert: SmartAlert, now: number): boolean {
  if (!alert.lastInvalidatedAt) return false
  return now - alert.lastInvalidatedAt < alert.cooldownMs
}

export interface AlertProcessResult {
  evaluation: AlertEvaluation
  /** Session window elapsed — the alert should be shown/persisted as paused, never fired. */
  expired: boolean
  inCooldown: boolean
  /** True only when the alert is enabled, not expired, confirmed (matched for confirmationCycles
   * consecutive cycles), and outside its cooldown window — the single gate that should ever cause
   * a push notification / "triggered" history row. */
  shouldFire: boolean
  /** The confirmation counter to persist for the next cycle regardless of whether it fired —
   * callers must write this back onto the stored alert (see localEvaluator.ts / smart-alerts-cycle). */
  nextPendingMatchCount: number
  /** True exactly once, the cycle a previously-fired alert's active match streak breaks — the gate
   * for an "invalidated" history row (see spec: alerts should tell you when a call no longer holds). */
  shouldInvalidate: boolean
}

/**
 * Advances one evaluation cycle for an alert. Firing requires the conditions to have matched for
 * `confirmationCycles` consecutive calls (default 1 = fires on the first match, the original
 * behavior) — this absorbs a single noisy/stale data point instead of firing on it directly.
 * Invalidation fires once, the cycle an alert that had already notified the user stops matching.
 */
export function processAlert(alert: SmartAlert, snapshot: MetricSnapshot, now: number): AlertProcessResult {
  const expired = isSessionExpired(alert, now)
  const evaluation = evaluateAlert(alert, snapshot)
  const inCooldown = isInCooldown(alert, now)

  const prevPendingMatchCount = alert.pendingMatchCount ?? 0
  const nextPendingMatchCount = evaluation.triggered ? prevPendingMatchCount + 1 : 0
  const requiredCycles = Math.max(1, alert.confirmationCycles ?? 1)
  const confirmed = nextPendingMatchCount >= requiredCycles

  const shouldFire = alert.enabled && !expired && confirmed && !inCooldown

  const shouldInvalidate =
    alert.enabled &&
    !expired &&
    !evaluation.triggered &&
    prevPendingMatchCount > 0 &&
    Boolean(alert.lastTriggeredAt) &&
    !isInvalidationCooldown(alert, now)

  return { evaluation, expired, inCooldown, shouldFire, nextPendingMatchCount, shouldInvalidate }
}
