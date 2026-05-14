import type { WhaleAlert, WhaleCategory } from '../types/domain'
import { LIVE_ASSETS } from '../constants/liveAssets'

const WHALE_TRACKED = new Set(LIVE_ASSETS.map((a) => a.symbol.toUpperCase()))

export function classifyWhaleAlert(alert: WhaleAlert): WhaleCategory {
  const text = (alert.text || '').toLowerCase()
  if (text.includes('mint') || text.includes('burn') || text.includes('treasury')) return 'supply'
  const hasFromKnown = Boolean(text.match(/from\s+#?\w/i) && !text.match(/from\s+unknown/i))
  const hasToKnown = Boolean(text.match(/to\s+#?\w/i) && !text.match(/to\s+unknown/i))
  const hasFromUnknown = text.includes('from unknown')
  const hasToUnknown = text.includes('to unknown')
  if (hasFromKnown && hasToUnknown) return 'hodl'
  if (hasFromUnknown && hasToKnown) return 'sell'
  if (hasFromKnown && hasToKnown) return 'volume'
  return 'volume'
}

export function whaleIconForCategory(cat: WhaleCategory): string {
  switch (cat) {
    case 'hodl':
      return '📥'
    case 'sell':
      return '📤'
    case 'supply':
      return '🏦'
    default:
      return '🐋'
  }
}

export function formatWhaleUsd(v: number): string {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K'
  return '$' + v.toFixed(0)
}

export function formatWhaleAmount(a: number): string {
  if (a >= 1e9) return (a / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (a / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return (a / 1e3).toFixed(0) + 'K'
  if (a >= 1) return a.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return a.toFixed(4)
}

export function whaleTimeAgo(
  ts: number,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const secs = Math.floor(Date.now() / 1000) - ts
  if (secs < 60) return tr('time.now')
  if (secs < 3600) return tr('time.minutesAgo', { count: Math.floor(secs / 60) })
  if (secs < 86400) return tr('time.hoursAgo', { count: Math.floor(secs / 3600) })
  return tr('time.daysAgo', { count: Math.floor(secs / 86400) })
}

/** Map symbol -> bullish | bearish | null from whale feed */
export function computeWhaleSentiment(alerts: WhaleAlert[]): Record<string, 'bullish' | 'bearish' | null> {
  const sentiment: Record<string, { bull: number; bear: number }> = {}
  let marketBullish = 0
  let marketBearish = 0

  alerts.forEach((alert) => {
    const cat = alert._category || 'volume'
    const amounts = alert.amounts || []
    amounts.forEach((a) => {
      const sym = (a.symbol || '').toUpperCase()
      const isStable = ['USDT', 'USDC', 'TUSD', 'DAI', 'BUSD'].includes(sym)
      if (isStable) {
        if (cat === 'supply') {
          const text = (alert.text || '').toLowerCase()
          if (text.includes('mint')) marketBullish += 1
          if (text.includes('burn')) marketBearish += 1
        }
        if (cat === 'sell') marketBearish += 0.5
        if (cat === 'hodl') marketBullish += 0.5
      } else if (WHALE_TRACKED.has(sym)) {
        if (!sentiment[sym]) sentiment[sym] = { bull: 0, bear: 0 }
        if (cat === 'hodl') sentiment[sym].bull += 1
        if (cat === 'sell') sentiment[sym].bear += 1
        if (cat === 'volume') sentiment[sym].bull += 0.3
      }
    })
  })

  const result: Record<string, 'bullish' | 'bearish' | null> = {}
  const marketNet = marketBullish - marketBearish
  const marketSignal = marketNet > 1 ? 'bullish' : marketNet < -1 ? 'bearish' : null

  WHALE_TRACKED.forEach((sym) => {
    const s = sentiment[sym]
    if (s) {
      const net = s.bull - s.bear
      if (net >= 1) result[sym] = 'bullish'
      else if (net <= -1) result[sym] = 'bearish'
      else result[sym] = marketSignal
    } else {
      result[sym] = marketSignal
    }
  })
  return result
}

export { WHALE_TRACKED }
