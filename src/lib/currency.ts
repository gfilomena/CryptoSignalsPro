import type { Currency } from '../types/domain'
import type { LiveAsset } from '../types/domain'

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  usd: '$',
  eur: '€',
  chf: 'CHF ',
}

export function getBinancePair(asset: LiveAsset, currency: Currency): string {
  if (currency === 'chf') return asset.pairs.usd
  return asset.pairs[currency] || asset.pairs.usd
}

export function applyChfConversion(value: number, currency: Currency, chfRate: number | null): number {
  if (currency === 'chf' && chfRate) return value * chfRate
  return value
}

export function formatPrice(price: number, currency: Currency): string {
  const sym = CURRENCY_SYMBOLS[currency]
  const decimals = price < 1 ? 4 : 2
  return (
    sym +
    price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: decimals,
    })
  )
}

export function formatVolume(vol: number): string {
  if (vol >= 1e9) return (vol / 1e9).toFixed(1) + 'B'
  if (vol >= 1e6) return (vol / 1e6).toFixed(1) + 'M'
  if (vol >= 1e3) return (vol / 1e3).toFixed(0) + 'K'
  return vol.toFixed(0)
}

export async function fetchChfRate(): Promise<number> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=CHF')
    const data = await res.json()
    return data.rates.CHF as number
  } catch {
    return 0.78
  }
}

export function formatPriceShort(price: number, currency: Currency): string {
  const sym = CURRENCY_SYMBOLS[currency]
  if (price >= 1000) return sym + price.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (price >= 1) return sym + price.toFixed(2)
  if (price >= 0.0001) return sym + price.toFixed(4)
  return sym + price.toFixed(8)
}
