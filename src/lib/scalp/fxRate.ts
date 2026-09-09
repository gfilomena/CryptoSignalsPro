import type { Currency } from '../../types/domain'

interface CachedRate {
  currency: Currency
  rate: number
  at: number
}

let cache: CachedRate | null = null
const TTL_MS = 5 * 60_000
const FALLBACK_RATES: Partial<Record<Currency, number>> = { chf: 0.88, eur: 0.92 }

/** Units of `currency` per 1 USD (e.g. ~0.88 for CHF). 1 for USD itself. */
export async function getUsdRate(currency: Currency): Promise<number> {
  if (currency === 'usd') return 1
  if (cache && cache.currency === currency && Date.now() - cache.at < TTL_MS) return cache.rate
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${currency.toUpperCase()}`)
    const data = await res.json()
    const rate = data.rates?.[currency.toUpperCase()] as number | undefined
    if (typeof rate === 'number' && rate > 0) {
      cache = { currency, rate, at: Date.now() }
      return rate
    }
  } catch {
    /* fall through to fallback */
  }
  return FALLBACK_RATES[currency] ?? 1
}
