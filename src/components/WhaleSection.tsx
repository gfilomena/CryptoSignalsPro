import { Fragment, useCallback, useEffect, useState } from 'react'
import { edgeFetch, hasSupabaseConfig } from '../config/supabaseClient'
import { useI18n } from '../i18n/useI18n'
import {
  classifyWhaleAlert,
  computeWhaleSentiment,
  formatWhaleAmount,
  formatWhaleUsd,
  whaleIconForCategory,
  whaleTimeAgo,
  WHALE_TRACKED,
} from '../lib/whale'
import type { WhaleAlert, WhaleCategory } from '../types/domain'
import { CollapsiblePanel } from './CollapsiblePanel'

interface Props {
  onSentimentChange: (map: Record<string, 'bullish' | 'bearish' | null>) => void
}

export function WhaleSection({ onSentimentChange }: Props) {
  const { t } = useI18n()
  const [alerts, setAlerts] = useState<WhaleAlert[]>([])
  const [filter, setFilter] = useState<'all' | WhaleCategory>('all')

  const fetchWhales = useCallback(async () => {
    if (!hasSupabaseConfig) return
    try {
      const res = await edgeFetch('/whale-proxy')
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        const enriched = data.map((a: WhaleAlert) => ({
          ...a,
          _category: classifyWhaleAlert(a),
        }))
        setAlerts(enriched)
      }
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    fetchWhales()
    const id = setInterval(fetchWhales, 60_000)
    return () => clearInterval(id)
  }, [fetchWhales])

  useEffect(() => {
    onSentimentChange(computeWhaleSentiment(alerts))
  }, [alerts, onSentimentChange])

  const filtered =
    filter === 'all' ? alerts : alerts.filter((a) => (a._category || 'volume') === filter)

  const btn = (f: typeof filter, label: string) => (
    <button
      type="button"
      className={`whale-filter-btn ${filter === f ? 'active' : ''}`}
      onClick={() => setFilter(f)}
    >
      {label}
    </button>
  )

  return (
    <CollapsiblePanel
      id="whaleSection"
      sectionClassName="whale-section"
      headerClassName="whale-header"
      title={
        <div className="whale-header-left">
          <div className="whale-title">{t('whale.title')}</div>
          <div className="whale-live-dot" />
        </div>
      }
      rightSlot={
        <div className="whale-count">
          {alerts.length > 0
            ? t('whale.alerts', { shown: String(filtered.length), total: String(alerts.length) })
            : ''}
        </div>
      }
    >
      <div className="whale-filters">
        {btn('all', t('whale.all'))}
        {btn('hodl', t('whale.hodl'))}
        {btn('sell', t('whale.sell'))}
        {btn('volume', t('whale.volume'))}
        {btn('supply', t('whale.supply'))}
      </div>
      <div className="whale-list" id="whaleList">
        {!hasSupabaseConfig ? (
          <div className="whale-empty">{t('whale.configure')}</div>
        ) : alerts.length === 0 ? (
          <div className="whale-empty">{t('whale.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="whale-empty">{t('whale.emptyFilter')}</div>
        ) : (
          filtered.map((alert, idx) => {
            const cat = (alert._category || 'volume') as WhaleCategory
            const icon = whaleIconForCategory(cat)
            const amounts = alert.amounts || []
            const totalUsd = amounts.reduce((s, a) => s + (a.value_usd || 0), 0)
            return (
              <div key={idx} className="whale-tx">
                <div className={`whale-tx-icon ${cat}`}>{icon}</div>
                <div className="whale-tx-body">
                  <div className="whale-tx-text">
                    {alert.emoticons ? (
                      <span style={{ letterSpacing: -2 }}>{alert.emoticons.slice(0, 10)}</span>
                    ) : null}{' '}
                    {amounts.map((a, i) => {
                      const sym = (a.symbol || '').toUpperCase()
                      const tracked = WHALE_TRACKED.has(sym)
                      return (
                        <Fragment key={`${sym}-${i}`}>
                          {i > 0 ? ' + ' : null}
                          <span className="whale-amount">{formatWhaleAmount(a.amount)}</span>{' '}
                          <span className="whale-symbol">#{sym}</span>
                          {tracked ? (
                            <span
                              style={{
                                background: 'rgba(56,189,248,0.15)',
                                color: '#38bdf8',
                                padding: '1px 5px',
                                borderRadius: 4,
                                fontSize: '0.66rem',
                                fontWeight: 700,
                                marginLeft: 3,
                              }}
                            >
                              {t('whale.track')}
                            </span>
                          ) : null}
                        </Fragment>
                      )
                    })}{' '}
                    {alert.text || ''}
                  </div>
                  <div className="whale-tx-meta">
                    <span className={`whale-tx-tag ${cat}`}>{t(`whale.cat.${cat}`)}</span>
                    <span className="whale-tx-time">{whaleTimeAgo(alert.timestamp, t)}</span>
                  </div>
                </div>
                <div className="whale-tx-value">{formatWhaleUsd(totalUsd)}</div>
              </div>
            )
          })
        )}
      </div>
    </CollapsiblePanel>
  )
}
