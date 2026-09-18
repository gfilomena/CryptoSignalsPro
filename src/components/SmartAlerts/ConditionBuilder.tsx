import { useI18n } from '../../i18n/useI18n'
import type { AlertCondition, AlertMetric, ConditionOperator, LogicalOperator, MetricTimeframe } from '../../types/smartAlert'
import { METRIC_TIMEFRAMES } from '../../types/smartAlert'
import { METRIC_DEFS, METRIC_GROUPS, metricRequiresTimeframe } from '../../lib/smartAlerts/metricDefs'
import { UNAVAILABLE_METRICS } from '../../lib/smartAlerts/marketData'
import { newCondition } from '../../lib/smartAlerts/presets'

const OPERATORS: ConditionOperator[] = ['>', '>=', '<', '<=', '==']

interface RowProps {
  condition: AlertCondition
  onChange: (patch: Partial<AlertCondition>) => void
  onRemove: () => void
}

function ConditionRow({ condition, onChange, onRemove }: RowProps) {
  const { t } = useI18n()
  const unavailable = UNAVAILABLE_METRICS.includes(condition.metric)
  const needsTimeframe = metricRequiresTimeframe(condition.metric)

  return (
    <div className="sa-condition-card">
      <div className="sa-condition-card-row">
        <select
          value={condition.metric}
          onChange={(e) => {
            const metric = e.target.value as AlertMetric
            onChange({ metric, timeframe: metricRequiresTimeframe(metric) ? (condition.timeframe ?? '15m') : undefined })
          }}
        >
          {METRIC_GROUPS.map((group) => (
            <optgroup key={group} label={t(`smartAlerts.metric.group.${group}`)}>
              {METRIC_DEFS.filter((d) => d.group === group).map((d) => (
                <option key={d.metric} value={d.metric}>
                  {t(`smartAlerts.metric.${d.key}`)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {needsTimeframe ? (
          <select value={condition.timeframe ?? '15m'} onChange={(e) => onChange({ timeframe: e.target.value as MetricTimeframe })}>
            {METRIC_TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}

        <select value={condition.operator} onChange={(e) => onChange({ operator: e.target.value as ConditionOperator })}>
          {OPERATORS.map((op) => (
            <option key={op} value={op}>
              {t(`smartAlerts.operator.${op}`)}
            </option>
          ))}
        </select>

        <input
          type="number"
          step="any"
          value={condition.threshold}
          onChange={(e) => onChange({ threshold: e.target.value === '' ? 0 : +e.target.value })}
        />

        <button type="button" className="sa-condition-remove" onClick={onRemove} title={t('smartAlerts.condition.removeCondition')}>
          ✕
        </button>
      </div>
      {unavailable ? <div className="sa-condition-unavailable">⚠ {t('smartAlerts.metric.unavailableHint')}</div> : null}
    </div>
  )
}

interface Props {
  conditions: AlertCondition[]
  operator: LogicalOperator
  onConditionsChange: (conditions: AlertCondition[]) => void
  onOperatorChange: (operator: LogicalOperator) => void
}

export function ConditionBuilder({ conditions, operator, onConditionsChange, onOperatorChange }: Props) {
  const { t } = useI18n()

  const updateCondition = (id: string, patch: Partial<AlertCondition>) =>
    onConditionsChange(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const removeCondition = (id: string) => onConditionsChange(conditions.filter((c) => c.id !== id))
  const addCondition = () => onConditionsChange([...conditions, newCondition()])

  return (
    <div>
      {conditions.length === 0 ? <p className="bt-field-hint" style={{ marginBottom: 10 }}>{t('smartAlerts.condition.noConditions')}</p> : null}

      {conditions.map((condition, i) => (
        <div key={condition.id}>
          {i > 0 ? (
            <div className="sa-logical-toggle">
              <div className="sa-segmented">
                <button type="button" className={operator === 'AND' ? 'active' : ''} onClick={() => onOperatorChange('AND')}>
                  {t('smartAlerts.logical.AND')}
                </button>
                <button type="button" className={operator === 'OR' ? 'active' : ''} onClick={() => onOperatorChange('OR')}>
                  {t('smartAlerts.logical.OR')}
                </button>
              </div>
            </div>
          ) : null}
          <ConditionRow condition={condition} onChange={(patch) => updateCondition(condition.id, patch)} onRemove={() => removeCondition(condition.id)} />
        </div>
      ))}

      <button type="button" className="sa-add-condition-btn" onClick={addCondition}>
        {t('smartAlerts.condition.addCondition')}
      </button>
    </div>
  )
}
