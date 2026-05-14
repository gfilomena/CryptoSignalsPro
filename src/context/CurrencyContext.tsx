import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Currency } from '../types/domain'
import { fetchChfRate, formatPrice as fmtPrice, formatPriceShort, formatVolume as fmtVol } from '../lib/currency'

interface CurrencyContextValue {
  currency: Currency
  setCurrency: (c: Currency) => void
  chfRate: number | null
  formatPrice: (n: number) => string
  formatVolume: (n: number) => string
  formatPriceShort: (n: number) => string
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

function readCurrencyFromUrl(): Currency {
  const p = new URLSearchParams(window.location.search).get('currency')?.toLowerCase()
  if (p === 'eur' || p === 'chf' || p === 'usd') return p
  return 'usd'
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(readCurrencyFromUrl)
  const [chfRate, setChfRate] = useState<number | null>(null)

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c)
    const url = new URL(window.location.href)
    url.searchParams.set('currency', c)
    window.history.replaceState({}, '', url)
  }, [])

  useEffect(() => {
    if (currency === 'chf') {
      fetchChfRate().then(setChfRate).catch(() => setChfRate(0.78))
    }
  }, [currency])

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      setCurrency,
      chfRate,
      formatPrice: (n: number) => fmtPrice(n, currency),
      formatVolume: (n: number) => fmtVol(n),
      formatPriceShort: (n: number) => formatPriceShort(n, currency),
    }),
    [currency, setCurrency, chfRate],
  )

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext)
  if (!ctx) throw new Error('useCurrency must be used within CurrencyProvider')
  return ctx
}
