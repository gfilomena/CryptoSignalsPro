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
import { SignalCard } from './components/SignalCard'
import { SetupPanel } from './components/SetupPanel'
import { SignalHistoryPanel } from './components/SignalHistoryPanel'
import { PaperTradingStats } from './components/PaperTradingStats'
import { UpdatePrompt } from './components/UpdatePrompt'
import { getStrategyConfig, type StrategyConfig } from './config/strategyConfig'
import { getSignalData, type SignalDataResult } from './lib/scalp/signalClient'
import { initServiceWorker, applyServiceWorkerUpdate } from './lib/push/swRegistration'

function Main() {
  const { t, locale } = useI18n()
  const { currency, chfRate, setCurrency, formatPrice, formatVolume } = useCurrency()
  const [cryptoBySymbol, setCryptoBySymbol] = useState<Record<string, CryptoSnapshot>>({})
  const [order, setOrder] = useState<string[]>([])
  const [lastUpdate, setLastUpdate] = useState('—')
  const [fg, setFg] = useState<FearGreedState | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [whaleMap, setWhaleMap] = useState<Record<string, 'bullish' | 'bearish' | null>>({})
  const [scalpConfig, setScalpConfig] = useState<StrategyConfig>(() => getStrategyConfig())
  const [signalData, setSignalData] = useState<SignalDataResult | null>(null)
  const [signalLoading, setSignalLoading] = useState(true)
  const [updateAvailable, setUpdateAvailable] = useState(false)

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

  useEffect(() => {
    initServiceWorker(() => setUpdateAvailable(true))
  }, [])

  useEffect(() => {
    let cancelled = false
    async function refreshSignal() {
      try {
        const data = await getSignalData(scalpConfig)
        if (!cancelled) setSignalData(data)
      } catch {
        /* keep last known signal on transient fetch errors */
      } finally {
        if (!cancelled) setSignalLoading(false)
      }
    }
    refreshSignal()
    const id = setInterval(refreshSignal, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [scalpConfig])

  const selectedAsset = useMemo(
    () => (selected ? cryptoBySymbol[selected] ?? null : null),
    [selected, cryptoBySymbol],
  )

  return (
    <div className="container">
      <UpdatePrompt visible={updateAvailable} onUpdate={applyServiceWorkerUpdate} onDismiss={() => setUpdateAvailable(false)} />

      <div className="header">
        <div className="header-top">
          <LanguageSelector />
        </div>
        <h1>{t('app.title')}</h1>
        <p>{t('app.subtitle')}</p>
      </div>

      <SetupPanel onConfigChange={setScalpConfig} />

      <SignalCard
        snapshot={signalData?.snapshot ?? null}
        loading={signalLoading}
        whaleContext={whaleMap[signalData?.snapshot?.symbol ?? 'BTC'] ?? null}
      />

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

      <SignalHistoryPanel trades={signalData?.paperTrades ?? []} />

      <PaperTradingStats stats={signalData?.paperStats ?? { totalTrades: 0, wins: 0, losses: 0, winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, expectancy: 0, maxDrawdown: 0, totalPnl: 0, avgRR: 0 }} />

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
          scalpSnapshot={selectedAsset.symbol === signalData?.snapshot.symbol ? signalData?.snapshot : null}
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
