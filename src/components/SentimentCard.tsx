import { useEffect, useState } from 'react'
import type { FearGreedState } from '../types/domain'
import { useI18n } from '../i18n/useI18n'

const FG_API: Record<string, 'extremeFear' | 'fear' | 'neutral' | 'greed' | 'extremeGreed'> = {
  'Extreme Fear': 'extremeFear',
  Fear: 'fear',
  Neutral: 'neutral',
  Greed: 'greed',
  'Extreme Greed': 'extremeGreed',
}

interface Props {
  data: FearGreedState | null
}

export function SentimentCard({ data }: Props) {
  const { t } = useI18n()
  const [infoOpen, setInfoOpen] = useState(false)

  useEffect(() => {
    if (!infoOpen) return
    const close = () => setInfoOpen(false)
    const timer = window.setTimeout(() => {
      document.addEventListener('click', close)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('click', close)
    }
  }, [infoOpen])

  const v = data?.value ?? null
  const meterKey = data ? FG_API[data.classification] ?? 'neutral' : null
  const label = data
    ? t(`sentiment.meter.${meterKey ?? 'neutral'}`)
    : t('sentiment.loading')

  let color = '#eab308'
  if (v != null) {
    if (v < 25) color = '#ef4444'
    else if (v < 45) color = '#f59e0b'
    else if (v < 55) color = '#eab308'
    else if (v < 75) color = '#84cc16'
    else color = '#22c55e'
  }

  return (
    <div className="sentiment-card">
      <div className="sentiment-card-header">
        <div className="sentiment-title">{t('sentiment.title')}</div>
        <button
          type="button"
          className="info-icon"
          aria-expanded={infoOpen}
          aria-label={t('sentiment.ariaInfo')}
          title={t('sentiment.infoTitle')}
          onClick={(e) => {
            e.stopPropagation()
            setInfoOpen((o) => !o)
          }}
        >
          ℹ️
        </button>
        {infoOpen ? (
          <div
            role="dialog"
            aria-label={t('tooltips.fear_greed.title')}
            className="tooltip sentiment-fg-tooltip active"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tooltip-title">{t('tooltips.fear_greed.title')}</div>
            <div className="tooltip-content" dangerouslySetInnerHTML={{ __html: t('tooltips.fear_greed.content') }} />
            <div className="tooltip-tip" dangerouslySetInnerHTML={{ __html: t('tooltips.fear_greed.tip') }} />
          </div>
        ) : null}
      </div>
      <div className="fear-greed-meter">
        <div className="fear-greed-pointer" style={{ left: v != null ? `${v}%` : '50%' }} id="fgPointer" />
      </div>
      <div className="fear-greed-labels">
        <span>{t('sentiment.meter.extremeFear')}</span>
        <span>{t('sentiment.meter.fear')}</span>
        <span>{t('sentiment.meter.neutral')}</span>
        <span>{t('sentiment.meter.greed')}</span>
        <span>{t('sentiment.meter.extremeGreed')}</span>
      </div>
      <div className="fear-greed-value" id="fgValue" style={{ color }}>
        {v != null ? `${v} — ${label}` : t('sentiment.loading')}
      </div>
    </div>
  )
}
