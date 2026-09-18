import type { AlertMetric } from '../../types/smartAlert'
import { TIMEFRAME_METRICS } from '../../types/smartAlert'

export type MetricGroup = 'PRICE' | 'OPEN_INTEREST' | 'FUNDING_RATE' | 'VOLUME' | 'RSI' | 'LIQUIDATIONS'

export interface MetricDef {
  metric: AlertMetric
  group: MetricGroup
  /** i18n key suffix under smartAlerts.metric.<key> */
  key: string
  requiresTimeframe: boolean
  unit: '$' | '%' | 'pts' | 'bool'
}

export const METRIC_DEFS: MetricDef[] = [
  { metric: 'PRICE', group: 'PRICE', key: 'PRICE', requiresTimeframe: false, unit: '$' },
  { metric: 'PRICE_CHANGE', group: 'PRICE', key: 'PRICE_CHANGE', requiresTimeframe: false, unit: '%' },
  { metric: 'OPEN_INTEREST', group: 'OPEN_INTEREST', key: 'OPEN_INTEREST', requiresTimeframe: false, unit: '$' },
  { metric: 'OPEN_INTEREST_CHANGE', group: 'OPEN_INTEREST', key: 'OPEN_INTEREST_CHANGE', requiresTimeframe: true, unit: '%' },
  { metric: 'FUNDING_RATE', group: 'FUNDING_RATE', key: 'FUNDING_RATE', requiresTimeframe: false, unit: '%' },
  { metric: 'VOLUME', group: 'VOLUME', key: 'VOLUME', requiresTimeframe: false, unit: '$' },
  { metric: 'VOLUME_CHANGE', group: 'VOLUME', key: 'VOLUME_CHANGE', requiresTimeframe: true, unit: '%' },
  { metric: 'RSI', group: 'RSI', key: 'RSI', requiresTimeframe: true, unit: 'pts' },
  { metric: 'LONG_LIQUIDATIONS', group: 'LIQUIDATIONS', key: 'LONG_LIQUIDATIONS', requiresTimeframe: false, unit: '$' },
  { metric: 'SHORT_LIQUIDATIONS', group: 'LIQUIDATIONS', key: 'SHORT_LIQUIDATIONS', requiresTimeframe: false, unit: '$' },
  { metric: 'LIQUIDATION_SPIKE', group: 'LIQUIDATIONS', key: 'LIQUIDATION_SPIKE', requiresTimeframe: false, unit: 'bool' },
]

export function metricDef(metric: AlertMetric): MetricDef {
  const def = METRIC_DEFS.find((d) => d.metric === metric)
  if (!def) throw new Error(`Unknown metric: ${metric}`)
  return def
}

export function metricRequiresTimeframe(metric: AlertMetric): boolean {
  return TIMEFRAME_METRICS.includes(metric)
}

export const METRIC_GROUPS: MetricGroup[] = ['PRICE', 'OPEN_INTEREST', 'FUNDING_RATE', 'VOLUME', 'RSI', 'LIQUIDATIONS']
