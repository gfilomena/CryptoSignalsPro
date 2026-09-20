import { useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import type { TriggeredAlertEvent } from '../../types/smartAlert'
import { whaleTimeAgo } from '../../lib/whale'
import { buildMetricLines } from '../../lib/smartAlerts/notificationCopy'

interface Props {
  events: TriggeredAlertEvent[]
  onMarkRead: (id: string) => void
  onDelete: (id: string) => void
}

export function HistoryList({ events, onMarkRead, onDelete }: Props) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (events.length === 0) return <p className="sa-empty">{t('smartAlerts.empty.triggered')}</p>

  return (
    <div className="sa-history-list">
      {events.map((event) => {
        const isOpen = expanded.has(event.id)
        // Older persisted rows may predate invalidation tracking and carry no kind — treat as triggered.
        const isInvalidated = event.kind === 'invalidated'
        return (
          <div className={`sa-history-item ${event.read ? '' : 'is-unread'} ${isInvalidated ? 'is-invalidated' : ''}`} key={event.id}>
            <div className="sa-history-top">
              <div>
                <div className="sa-history-title">{event.symbol}/USDT</div>
                <div style={{ fontSize: '0.82rem', opacity: 0.75 }}>
                  {isInvalidated ? `↩️ ${t('smartAlerts.history.invalidated', { name: event.alertName })}` : t('smartAlerts.history.triggered', { name: event.alertName })}
                </div>
              </div>
              <div className="sa-history-time">{whaleTimeAgo(Math.floor(event.timestamp / 1000), t)}</div>
            </div>

            {isOpen ? (
              <div className="sa-history-lines">
                {buildMetricLines(event.snapshot).map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            ) : null}

            <div className="sa-history-actions">
              <button type="button" onClick={() => toggleExpanded(event.id)}>
                {isOpen ? t('smartAlerts.history.hideDetails') : t('smartAlerts.history.viewDetails')}
              </button>
              {!event.read ? (
                <button type="button" onClick={() => onMarkRead(event.id)}>
                  {t('smartAlerts.history.markRead')}
                </button>
              ) : null}
              <button type="button" onClick={() => onDelete(event.id)}>
                {t('smartAlerts.history.delete')}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
