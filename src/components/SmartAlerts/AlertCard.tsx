import { useI18n } from '../../i18n/useI18n'
import type { MetricSnapshot, SmartAlert } from '../../types/smartAlert'
import { readLiveConditionState } from './formatCondition'

interface Props {
  alert: SmartAlert
  snapshot?: MetricSnapshot
  onEdit: () => void
  onTogglePause: () => void
  onDelete: () => void
}

export function AlertCard({ alert, snapshot, onEdit, onTogglePause, onDelete }: Props) {
  const { t, locale } = useI18n()
  const isActive = alert.enabled && !alert.sessionExpired

  return (
    <div className={`sa-card ${isActive ? '' : 'is-paused'}`}>
      <div className="sa-card-top">
        <div>
          <div className="sa-card-symbol">{alert.symbol}/USDT</div>
          <div className="sa-card-name">{alert.name}</div>
        </div>
        <span className={`sa-badge ${isActive ? 'active' : 'paused'}`}>
          ● {isActive ? t('smartAlerts.card.active') : alert.sessionExpired ? t('smartAlerts.card.sessionExpired') : t('smartAlerts.card.paused')}
        </span>
      </div>

      <div className="sa-card-conditions">
        <div style={{ fontSize: '0.7rem', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{t('smartAlerts.card.conditions')}</div>
        {alert.conditions
          .filter((c) => c.enabled)
          .map((condition) => {
            const live = readLiveConditionState(t, condition, snapshot)
            return (
              <div className="sa-condition-line" key={condition.id}>
                <span className="sa-c-metric">{live.label}</span>
                <span className={`sa-c-value ${live.matched === null ? 'muted' : live.matched ? 'positive' : 'negative'}`}>
                  {live.valueText ?? t('smartAlerts.card.unavailableData')}
                </span>
              </div>
            )
          })}
      </div>

      <div className="sa-card-meta">
        <span>
          {t('smartAlerts.card.mode')}: {alert.mode === 'ALWAYS' ? t('smartAlerts.mode.always') : t('smartAlerts.mode.session')}
        </span>
        <span>
          {t('smartAlerts.card.created')}: {new Date(alert.createdAt).toLocaleDateString(locale)}
        </span>
      </div>

      <div className="sa-card-actions">
        <button type="button" onClick={onEdit}>
          {t('smartAlerts.card.edit')}
        </button>
        <button type="button" onClick={onTogglePause}>
          {isActive ? t('smartAlerts.card.pause') : t('smartAlerts.card.resume')}
        </button>
        <button
          type="button"
          className="sa-danger"
          onClick={() => {
            if (window.confirm(t('smartAlerts.card.confirmDelete'))) onDelete()
          }}
        >
          {t('smartAlerts.card.delete')}
        </button>
      </div>
    </div>
  )
}
