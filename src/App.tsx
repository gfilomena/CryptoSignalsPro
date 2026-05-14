import { useCallback, useEffect, useMemo, useState } from 'react'
import { LIVE_ASSETS } from './constants/liveAssets'
import { CurrencyProvider, useCurrency } from './context/CurrencyContext'
import { useI18n } from './i18n/useI18n'
import { LanguageSelector } from './i18n/LanguageSelector'
import { localeTag } from './i18n/utils'
import { fetchCryptoSnapshot } from './lib/marketData'
import type { CryptoSnapshot, FearGreedState } from './types/domain'
import { MarketGrid } from './components/MarketGrid'
import { DetailView } from './components/DetailView'
import { SentimentCard } from './components/SentimentCard'
import { WhaleSection } from './components/WhaleSection'
import { BacktestSection } from './components/BacktestSection'

function Main() {
  const { t, locale } = useI18n()
  const { currency, chfRate, setCurrency, formatPrice, formatVolume } = useCurrency()
  const [cryptoBySymbol, setCryptoBySymbol] = useState<Record<string, CryptoSnapshot>>({})
  const [order, setOrder] = useState<string[]>([])
  const [lastUpdate, setLastUpdate] = useState('—')
  const [fg, setFg] = useState<FearGreedState | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [whaleMap, setWhaleMap] = useState<Record<string, 'bullish' | 'bearish' | null>>({})

  const refresh = useCallback(async () => {
    if (currency === 'chf' && !chfRate) return
    const results = await Promise.all(
      LIVE_ASSETS.map((a) => fetchCryptoSnapshot(a, currency, chfRate)),
    )
    const map: Record<string, CryptoSnapshot> = {}
    results.forEach((d) => {
      if (d) map[d.symbol] = d
    })
    setCryptoBySymbol(map)
    setOrder(LIVE_ASSETS.map((a) => a.symbol).filter((s) => map[s]))
    setLastUpdate(new Date().toLocaleTimeString(localeTag(locale)))
  }, [currency, chfRate, locale])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    async function loadFg() {
      try {
        const res = await fetch('https://api.alternative.me/fng/')
        const data = await res.json()
        setFg({
          value: parseInt(data.data[0].value, 10),
          classification: data.data[0].value_classification,
        })
      } catch {
        /* ignore */
      }
    }
    loadFg()
    const id = setInterval(loadFg, 300_000)
    return () => clearInterval(id)
  }, [])

  const selectedAsset = useMemo(
    () => (selected ? cryptoBySymbol[selected] ?? null : null),
    [selected, cryptoBySymbol],
  )

  return (
    <div className="container">
      <div className="header">
        <div className="header-top">
          <LanguageSelector />
        </div>
        <h1>{t('app.title')}</h1>
        <p>{t('app.subtitle')}</p>
      </div>

      <div className="status-bar">
        <div className="status-item">
          <div className="live-indicator" />
          <span className="status-label">{t('status.status')}</span>
          <span className="status-value">{t('status.live')}</span>
        </div>
        <div className="status-item">
          <span className="status-label">{t('status.dataSource')}</span>
          <span className="status-value">{t('status.binance')}</span>
        </div>
        <div className="status-item">
          <span className="status-label">{t('status.update')}</span>
          <span className="status-value" id="lastUpdate">
            {lastUpdate}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">{t('status.assets')}</span>
          <span className="status-value" id="assetCount">
            {order.length}
          </span>
        </div>
        <div className="currency-selector">
          <label htmlFor="currencySelect">{t('currency.label')}</label>
          <select
            id="currencySelect"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as 'usd' | 'eur' | 'chf')}
          >
            <option value="usd">USD ($)</option>
            <option value="eur">EUR (€)</option>
            <option value="chf">CHF (Fr.)</option>
          </select>
        </div>
      </div>

      <WhaleSection onSentimentChange={setWhaleMap} />

      <BacktestSection />

      <SentimentCard data={fg} />

      <MarketGrid
        data={cryptoBySymbol}
        order={order}
        selected={selected}
        onSelect={(sym) => {
          setSelected(sym)
          document.getElementById('detailedView')?.scrollIntoView({ behavior: 'smooth' })
        }}
        whaleSentiment={whaleMap}
        formatPrice={formatPrice}
      />

      {selectedAsset ? (
        <DetailView
          asset={selectedAsset}
          currency={currency}
          chfRate={chfRate}
          formatPrice={formatPrice}
          formatVolume={formatVolume}
        />
      ) : null}
    </div>
  )
}

export default function App() {
  return (
    <CurrencyProvider>
      <Main />
    </CurrencyProvider>
  )
}
