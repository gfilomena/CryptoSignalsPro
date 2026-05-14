import type { CryptoSnapshot } from '../types/domain'
import { useI18n } from '../i18n/useI18n'

interface Props {
  data: Record<string, CryptoSnapshot>
  order: string[]
  selected: string | null
  onSelect: (symbol: string) => void
  whaleSentiment: Record<string, 'bullish' | 'bearish' | null>
  formatPrice: (n: number) => string
}

export function MarketGrid({ data, order, selected, onSelect, whaleSentiment, formatPrice }: Props) {
  const { t } = useI18n()

  if (order.length === 0) {
    return (
      <div className="market-overview" id="marketOverview">
        <div className="loading">{t('market.loading')}</div>
      </div>
    )
  }

  return (
    <div className="market-overview" id="marketOverview">
      {order.map((sym) => {
        const asset = data[sym]
        if (!asset) return null
        const ws = whaleSentiment[sym]
        const whaleBadge =
          ws === 'bullish' ? (
            <div className="whale-badge bullish">🐋 W+</div>
          ) : ws === 'bearish' ? (
            <div className="whale-badge bearish">🐋 W−</div>
          ) : null

        const sig = asset.signal.type
        const signalUi =
          sig === 'buy'
            ? { icon: '🟢', labelKey: 'market.labelBuy' as const }
            : sig === 'sell'
              ? { icon: '🔴', labelKey: 'market.labelSell' as const }
              : { icon: '⚪', labelKey: 'market.labelHold' as const }
        const ch = asset.priceChange24h >= 0 ? 'positive' : 'negative'

        return (
          <button
            type="button"
            key={sym}
            className={`crypto-card ${selected === sym ? 'selected' : ''}`}
            onClick={() => onSelect(sym)}
          >
            <div className={`signal-badge ${sig}`} aria-hidden>
              <span className="signal-badge__ico">{signalUi.icon}</span>
              <span className="signal-badge__lbl">{t(signalUi.labelKey)}</span>
            </div>
            <div className="crypto-symbol">{asset.symbol}</div>
            <div className="crypto-name">{asset.name}</div>
            <div className="crypto-price">{formatPrice(asset.price)}</div>
            <div className={`crypto-change ${ch}`}>
              {asset.priceChange24h >= 0 ? '+' : ''}
              {asset.priceChange24h.toFixed(2)}%
            </div>
            {whaleBadge}
          </button>
        )
      })}
    </div>
  )
}
