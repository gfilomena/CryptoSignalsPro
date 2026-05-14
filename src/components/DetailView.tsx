import { useState } from 'react'
import type { CryptoSnapshot } from '../types/domain'
import { LIVE_ASSETS } from '../constants/liveAssets'
import { useI18n } from '../i18n/useI18n'
import type { ChartTfKey } from '../lib/chart'
import type { Currency } from '../types/domain'
import { PriceChartBlock } from './PriceChartBlock'

interface Props {
  asset: CryptoSnapshot
  currency: Currency
  chfRate: number | null
  formatPrice: (n: number) => string
  formatVolume: (n: number) => string
}

function IndicatorCard({
  tooltipKey,
  label,
  value,
  color,
  status,
  onInfo,
}: {
  tooltipKey: string
  label: string
  value: string
  color: string
  status: string
  onInfo: (key: string, e: React.MouseEvent) => void
}) {
  return (
    <div className="indicator-card">
      <button type="button" className="info-icon" data-tooltip={tooltipKey} onClick={(e) => onInfo(tooltipKey, e)}>
        ℹ️
      </button>
      <div className="indicator-label">{label}</div>
      <div className="indicator-value" style={{ color }}>
        {value}
      </div>
      {status ? (
        <div
          className="indicator-status"
          style={{
            background:
              color === '#22c55e'
                ? 'rgba(34, 197, 94, 0.2)'
                : color === '#ef4444'
                  ? 'rgba(239, 68, 68, 0.2)'
                  : 'rgba(234, 179, 8, 0.2)',
            color,
          }}
        >
          {status}
        </div>
      ) : null}
    </div>
  )
}

export function DetailView({ asset, currency, chfRate, formatPrice, formatVolume }: Props) {
  const { t } = useI18n()
  const [tf, setTf] = useState<ChartTfKey>('1S')
  const [tip, setTip] = useState<{ key: string; x: number; y: number } | null>(null)

  const onInfo = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const card = (e.target as HTMLElement).closest('.indicator-card')
    const rect = card?.getBoundingClientRect()
    setTip({ key, x: rect?.right ?? 0, y: rect?.top ?? 0 })
  }

  const base = tip ? `tooltips.${tip.key}` : null

  const rsiStatus =
    asset.rsi < 30
      ? t('detail.rsiStatus.oversold')
      : asset.rsi > 70
        ? t('detail.rsiStatus.overbought')
        : t('detail.rsiStatus.neutral')
  const rsiColor = asset.rsi < 30 ? '#22c55e' : asset.rsi > 70 ? '#ef4444' : '#eab308'

  return (
    <div className="detailed-view active" id="detailedView">
      {tip && base ? (
        <div
          role="dialog"
          className="tooltip active"
          style={{ position: 'fixed', top: tip.y + 8, left: Math.min(tip.x, window.innerWidth - 360), zIndex: 2000 }}
          onClick={() => setTip(null)}
        >
          <div className="tooltip-title">{t(`${base}.title`)}</div>
          <div className="tooltip-content" dangerouslySetInnerHTML={{ __html: t(`${base}.content`) }} />
          <div className="tooltip-tip" dangerouslySetInnerHTML={{ __html: t(`${base}.tip`) }} />
        </div>
      ) : null}

      <div className="detail-header">
        <div>
          <div className="detail-title">
            {asset.symbol} - {asset.name}
          </div>
        </div>
        <div className="detail-price">
          <div className="detail-price-value">{formatPrice(asset.price)}</div>
          <div className={`detail-change ${asset.priceChange24h >= 0 ? 'positive' : 'negative'}`}>
            {asset.priceChange24h >= 0 ? '+' : ''}
            {asset.priceChange24h.toFixed(2)}% {t('detail.h24')}
          </div>
        </div>
      </div>

      <PriceChartBlock
        symbol={asset.symbol}
        timeframe={tf}
        onTimeframe={setTf}
        assets={LIVE_ASSETS}
        currency={currency}
        chfRate={chfRate}
      />

      <div className="indicators-grid">
        <IndicatorCard
          tooltipKey="rsi"
          label={t('detail.labels.rsi')}
          value={asset.rsi.toFixed(1)}
          color={rsiColor}
          status={rsiStatus}
          onInfo={onInfo}
        />
        <IndicatorCard
          tooltipKey="macd"
          label={t('detail.labels.macd')}
          value={asset.macd.macd.toFixed(2)}
          color={asset.macd.macd > 0 ? '#22c55e' : '#ef4444'}
          status={asset.macd.macd > 0 ? t('detail.macdStatus.bull') : t('detail.macdStatus.bear')}
          onInfo={onInfo}
        />
        <IndicatorCard
          tooltipKey="ema20"
          label={t('detail.labels.ema20')}
          value={formatPrice(asset.ema20)}
          color={asset.price > asset.ema20 ? '#22c55e' : '#ef4444'}
          status={asset.price > asset.ema20 ? t('detail.emaStatus.above') : t('detail.emaStatus.below')}
          onInfo={onInfo}
        />
        <IndicatorCard
          tooltipKey="ema50"
          label={t('detail.labels.ema50')}
          value={formatPrice(asset.ema50)}
          color={asset.price > asset.ema50 ? '#22c55e' : '#ef4444'}
          status={asset.price > asset.ema50 ? t('detail.emaStatus.above') : t('detail.emaStatus.below')}
          onInfo={onInfo}
        />
        <IndicatorCard
          tooltipKey="support"
          label={t('detail.labels.support')}
          value={formatPrice(asset.support)}
          color="#22c55e"
          status={t('detail.supportDist', { pct: ((1 - asset.support / asset.price) * 100).toFixed(1) })}
          onInfo={onInfo}
        />
        <IndicatorCard
          tooltipKey="resistance"
          label={t('detail.labels.resistance')}
          value={formatPrice(asset.resistance)}
          color="#ef4444"
          status={t('detail.resistanceDist', { pct: ((asset.resistance / asset.price - 1) * 100).toFixed(1) })}
          onInfo={onInfo}
        />
        <IndicatorCard
          tooltipKey="bb_upper"
          label={t('detail.labels.bbUpper')}
          value={formatPrice(asset.bb.upper)}
          color="#fff"
          status=""
          onInfo={onInfo}
        />
        <IndicatorCard
          tooltipKey="bb_lower"
          label={t('detail.labels.bbLower')}
          value={formatPrice(asset.bb.lower)}
          color="#fff"
          status=""
          onInfo={onInfo}
        />
        <IndicatorCard
          tooltipKey="high24h"
          label={t('detail.labels.high24h')}
          value={formatPrice(asset.high24h)}
          color="#fff"
          status=""
          onInfo={onInfo}
        />
        <IndicatorCard
          tooltipKey="low24h"
          label={t('detail.labels.low24h')}
          value={formatPrice(asset.low24h)}
          color="#fff"
          status=""
          onInfo={onInfo}
        />
        <IndicatorCard
          tooltipKey="volume"
          label={t('detail.labels.volume24h')}
          value={formatVolume(asset.volume24h)}
          color="#fff"
          status=""
          onInfo={onInfo}
        />
        <IndicatorCard
          tooltipKey="confidence"
          label={t('detail.labels.confidence')}
          value={`${asset.signal.confidence}%`}
          color={asset.signal.confidence > 70 ? '#22c55e' : asset.signal.confidence > 40 ? '#eab308' : '#ef4444'}
          status=""
          onInfo={onInfo}
        />
      </div>

      <div className="signals-section">
        <div className="signals-header">{t('detail.analysis')}</div>
        <div className={`signal-card ${asset.signal.type}`}>
          <div className="signal-title">
            {asset.signal.type === 'buy'
              ? t('detail.signalBuy')
              : asset.signal.type === 'sell'
                ? t('detail.signalSell')
                : t('detail.signalNeutral')}
          </div>
          <div className="signal-details">
            <div className="signal-detail">
              <strong>{t('detail.score')}</strong> {asset.signal.score > 0 ? '+' : ''}
              {asset.signal.score}
            </div>
            <div className="signal-detail">
              <strong>{t('detail.confidence')}</strong> {asset.signal.confidence}%
            </div>
            <div className="signal-detail">
              <strong>{t('detail.trend')}</strong>{' '}
              {asset.price > asset.ema20 && asset.price > asset.ema50
                ? t('detail.trendBull')
                : asset.price < asset.ema20 && asset.price < asset.ema50
                  ? t('detail.trendBear')
                  : t('detail.trendSide')}
            </div>
          </div>
          <div style={{ marginTop: 15 }}>
            <strong>{t('detail.reasonsTitle')}</strong>
            <ul style={{ listStyle: 'none', padding: '10px 0 0 0' }}>
              {asset.signal.reasons.map((reason, i) => (
                <li key={i} style={{ padding: '5px 0' }}>
                  • {t(`signalReasons.${reason.k}`, reason.v)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
