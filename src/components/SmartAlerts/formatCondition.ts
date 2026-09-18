import type { AlertCondition, MetricSnapshot } from '../../types/smartAlert'
import { metricDef } from '../../lib/smartAlerts/metricDefs'
import { evaluateCondition, readMetricValue } from '../../lib/smartAlerts/conditionEngine'

type TFunc = (key: string, params?: Record<string, string | number>) => string

function formatThreshold(unit: string, value: number): string {
  if (unit === '$') return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (unit === '%') return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
  if (unit === 'bool') return value ? 'yes' : 'no'
  return `${Math.round(value * 100) / 100}`
}

/** Renders a condition as "Price change ≤ -0.5%" style text, used by the condition builder
 * summary, alert cards, and the review screen — one shared source so the wording never drifts. */
export function formatConditionLine(t: TFunc, condition: AlertCondition): string {
  const def = metricDef(condition.metric)
  const label = t(`smartAlerts.metric.${def.key}`)
  const tf = condition.timeframe ? ` (${condition.timeframe})` : ''
  const opSymbol = t(`smartAlerts.operator.${condition.operator}`)
  return `${label}${tf} ${opSymbol} ${formatThreshold(def.unit, condition.threshold)}`
}

export function formatConditionShort(condition: AlertCondition): { label: string; value: string } {
  const def = metricDef(condition.metric)
  return { label: def.key, value: formatThreshold(def.unit, condition.threshold) }
}

export interface LiveConditionState {
  label: string
  /** The condition's current live reading, formatted, or null when the metric is unavailable. */
  valueText: string | null
  /** Whether the condition is currently matched by live data (null when unavailable). */
  matched: boolean | null
}

/** Reads the live value for a condition out of a snapshot for the alert card's "current state of
 * each monitored parameter" display (spec §8) — degrades gracefully to "—" when unavailable. */
export function readLiveConditionState(t: TFunc, condition: AlertCondition, snapshot: MetricSnapshot | undefined): LiveConditionState {
  const def = metricDef(condition.metric)
  const label = t(`smartAlerts.metric.${def.key}`) + (condition.timeframe ? ` (${condition.timeframe})` : '')
  if (!snapshot) return { label, valueText: null, matched: null }
  const value = readMetricValue(condition, snapshot)
  if (value === null) return { label, valueText: null, matched: null }
  return { label, valueText: formatThreshold(def.unit, value), matched: evaluateCondition(condition, snapshot) }
}
