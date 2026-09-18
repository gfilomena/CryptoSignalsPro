import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSmartAlertSnapshot, toFuturesPair } from '../marketData'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toFuturesPair', () => {
  it('appends USDT to a bare symbol', () => {
    expect(toFuturesPair('BTC')).toBe('BTCUSDT')
  })
  it('leaves an already-suffixed pair untouched', () => {
    expect(toFuturesPair('ethusdt')).toBe('ETHUSDT')
  })
})

describe('fetchSmartAlertSnapshot', () => {
  it('populates every metric when all Binance calls succeed', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/fapi/v1/ticker/24hr')) return jsonResponse({ lastPrice: '81240', priceChangePercent: '-0.62', quoteVolume: '1000000' })
      if (url.includes('/fapi/v1/openInterest')) return jsonResponse({ openInterest: '50000' })
      if (url.includes('/futures/data/openInterestHist')) {
        return jsonResponse([
          { sumOpenInterest: '49000', timestamp: 1 },
          { sumOpenInterest: '49700', timestamp: 2 },
        ])
      }
      if (url.includes('/fapi/v1/premiumIndex')) return jsonResponse({ lastFundingRate: '0.0001' })
      if (url.includes('/fapi/v1/klines')) {
        const candles = Array.from({ length: 200 }, (_, i) => [
          i, '100', '101', '99', String(100 + Math.sin(i) * 5), String(1000 + i),
        ])
        return jsonResponse(candles)
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await fetchSmartAlertSnapshot('BTC', ['15m'])
    expect(snapshot.symbol).toBe('BTC')
    expect(snapshot.price).toBe(81240)
    expect(snapshot.priceChangePct).toBe(-0.62)
    expect(snapshot.openInterest).toBe(50000)
    expect(snapshot.openInterestChangePct['15m']).toBeCloseTo(1.4286, 3)
    expect(snapshot.fundingRate).toBeCloseTo(0.01, 5)
    expect(snapshot.volume).toBe(1000000)
    expect(typeof snapshot.rsi['15m']).toBe('number')
    expect(snapshot.longLiquidations).toBeNull()
    expect(snapshot.shortLiquidations).toBeNull()
    expect(snapshot.liquidationSpike).toBeNull()
  })

  it('degrades individual metrics to null instead of throwing when one endpoint fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/fapi/v1/ticker/24hr')) return jsonResponse({ lastPrice: '81240', priceChangePercent: '-0.62', quoteVolume: '1000000' })
      if (url.includes('/fapi/v1/openInterest')) return jsonResponse({}, false, 500)
      if (url.includes('/futures/data/openInterestHist')) return jsonResponse([])
      if (url.includes('/fapi/v1/premiumIndex')) return jsonResponse({}, false, 503)
      if (url.includes('/fapi/v1/klines')) return jsonResponse([])
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await fetchSmartAlertSnapshot('BTC', ['15m'])
    expect(snapshot.price).toBe(81240) // ticker succeeded
    expect(snapshot.openInterest).toBeNull() // 500 -> null, not thrown
    expect(snapshot.fundingRate).toBeNull() // 503 -> null
    expect(snapshot.openInterestChangePct['15m']).toBeNull() // insufficient history points
    expect(snapshot.rsi['15m']).toBeNull() // insufficient candles
  })

  it('degrades the entire snapshot to all-null metrics when every call fails (network down)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, false, 500)))
    const snapshot = await fetchSmartAlertSnapshot('BTC', ['15m'])
    expect(snapshot.price).toBeNull()
    expect(snapshot.openInterest).toBeNull()
    expect(snapshot.fundingRate).toBeNull()
    expect(snapshot.volume).toBeNull()
  })
})
