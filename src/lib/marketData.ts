import type { Currency, CryptoSnapshot, LiveAsset } from '../types/domain'
import {
  calculateATR,
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateOBV,
  calculateRSI,
  detectRSIDivergence,
} from './indicators'
import { analyzeLiveSignal } from './liveSignal'
import { applyChfConversion, getBinancePair } from './currency'

export async function fetchCryptoSnapshot(
  asset: LiveAsset,
  currency: Currency,
  chfRate: number | null,
): Promise<CryptoSnapshot | null> {
  try {
    const pair = getBinancePair(asset, currency)
    const tickerUrl = `https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`
    const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=4h&limit=200`
    const [tickerRes, klinesRes] = await Promise.all([fetch(tickerUrl), fetch(klinesUrl)])
    const ticker = await tickerRes.json()
    const klines = (await klinesRes.json()) as number[][]

    const prices = klines.map((k) => parseFloat(String(k[4])))
    const volumes = klines.map((k) => parseFloat(String(k[5])))
    let currentPrice = parseFloat(ticker.lastPrice)
    let high24h = parseFloat(ticker.highPrice)
    let low24h = parseFloat(ticker.lowPrice)
    let volume24h = parseFloat(ticker.volume)

    if (currency === 'chf') {
      currentPrice = applyChfConversion(currentPrice, currency, chfRate)
      high24h = applyChfConversion(high24h, currency, chfRate)
      low24h = applyChfConversion(low24h, currency, chfRate)
      for (let i = 0; i < prices.length; i++) prices[i] = applyChfConversion(prices[i], currency, chfRate)
    }
    prices.push(currentPrice)
    volumes.push(volume24h)

    const rsi = calculateRSI(prices)
    const macdData = calculateMACD(prices)
    const ema20 = calculateEMA(prices, 20)
    const ema50 = calculateEMA(prices, 50)
    const ema200 = calculateEMA(prices, 200)
    const bb = calculateBollingerBands(prices)
    const atr = calculateATR(klines, 14)
    const obv = calculateOBV(prices, volumes)
    const rsiDivergence = detectRSIDivergence(prices)

    const swingBars = Math.min(20, klines.length)
    let support = low24h
    let resistance = high24h
    if (swingBars > 0) {
      let sMin = Infinity
      let sMax = 0
      for (const k of klines.slice(-swingBars)) {
        let lo = parseFloat(String(k[3]))
        let hi = parseFloat(String(k[2]))
        if (currency === 'chf') {
          lo = applyChfConversion(lo, currency, chfRate)
          hi = applyChfConversion(hi, currency, chfRate)
        }
        if (lo < sMin) sMin = lo
        if (hi > sMax) sMax = hi
      }
      if (Number.isFinite(sMin) && sMin > 0) support = sMin
      if (Number.isFinite(sMax) && sMax > 0) resistance = sMax
    }

    const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0

    const signal = analyzeLiveSignal({
      symbol: asset.symbol,
      price: currentPrice,
      rsi,
      macd: macdData.macd,
      macdHistogram: macdData.histogram,
      ema20,
      ema50,
      ema200,
      bb,
      priceChange24h: parseFloat(ticker.priceChangePercent),
      atrPct,
      obvDivergence: obv.divergence,
      obvTrend: obv.trend,
      rsiDivergence,
    })

    return {
      symbol: asset.symbol,
      name: asset.name,
      price: currentPrice,
      priceChange24h: parseFloat(ticker.priceChangePercent),
      volume24h,
      high24h,
      low24h,
      support,
      resistance,
      rsi,
      macd: macdData,
      ema20,
      ema50,
      ema200,
      bb,
      atrPct,
      obv,
      rsiDivergence,
      signal,
      timestamp: Date.now(),
    }
  } catch (e) {
    console.error(`Error fetching ${asset.symbol}:`, e)
    return null
  }
}
