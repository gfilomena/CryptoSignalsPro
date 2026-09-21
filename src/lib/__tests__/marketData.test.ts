import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCryptoSnapshot } from '../marketData'
import { calculateOBV, calculateRSI } from '../indicators'
import { LIVE_ASSETS } from '../../constants/liveAssets'

afterEach(() => vi.unstubAllGlobals())

/** 200 rising 4h klines; the LAST one is the still-forming candle (Binance behaviour). */
function fakeKlines(): number[][] {
  return Array.from({ length: 200 }, (_, i) => {
    const c = 100 + i + (i % 3)
    return [i * 14_400_000, c - 1, c + 1, c - 2, c, 50 + (i % 7)]
  })
}

describe('fetchCryptoSnapshot (dashboard BUY/SELL inputs)', () => {
  it('does not double-count the forming candle and keeps OBV on 4h volumes', async () => {
    const klines = fakeKlines()
    const lastPrice = 305.5
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        json: async () =>
          String(url).includes('ticker/24hr')
            ? { lastPrice: String(lastPrice), highPrice: '320', lowPrice: '290', volume: '123456', priceChangePercent: '1.2' }
            : klines,
      })),
    )
    const snap = await fetchCryptoSnapshot(LIVE_ASSETS[0], 'usd', null)
    expect(snap).not.toBeNull()

    const closes = klines.map((k) => k[4])
    const expectedPrices = [...closes.slice(0, -1), lastPrice] // forming candle's close refreshed, NOT a 201st point
    expect(snap!.rsi).toBeCloseTo(calculateRSI(expectedPrices), 10)
    expect(snap!.obv).toEqual(calculateOBV(expectedPrices, klines.map((k) => k[5])))
  })
})
