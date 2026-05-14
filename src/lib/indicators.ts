import type { BollingerBands, MacdData, ObvResult } from '../types/domain'

export function calculateRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50
  let gains = 0
  let losses = 0
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1]
    if (change > 0) gains += change
    else losses -= change
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

export function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1]
  const k = 2 / (period + 1)
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k)
  }
  return ema
}

export function calculateMACDSeries(prices: number[]): number[] {
  if (prices.length < 26) return []
  const k12 = 2 / 13
  const k26 = 2 / 27
  let ema12 = prices.slice(0, 12).reduce((a, b) => a + b, 0) / 12
  let ema26 = prices.slice(0, 26).reduce((a, b) => a + b, 0) / 26
  const series: number[] = []
  for (let i = 12; i < 26; i++) ema12 = prices[i] * k12 + ema12 * (1 - k12)
  for (let i = 26; i < prices.length; i++) {
    ema12 = prices[i] * k12 + ema12 * (1 - k12)
    ema26 = prices[i] * k26 + ema26 * (1 - k26)
    series.push(ema12 - ema26)
  }
  return series
}

export function calculateMACD(prices: number[]): MacdData {
  const series = calculateMACDSeries(prices)
  if (series.length === 0) return { macd: 0, signal: 0, histogram: 0 }
  const macd = series[series.length - 1]
  const signalPeriod = 9
  let signal: number
  if (series.length < signalPeriod) {
    signal = series.reduce((a, b) => a + b, 0) / series.length
  } else {
    const kSig = 2 / (signalPeriod + 1)
    signal = series.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod
    for (let i = signalPeriod; i < series.length; i++) {
      signal = series[i] * kSig + signal * (1 - kSig)
    }
  }
  return { macd, signal, histogram: macd - signal }
}

export function calculateBollingerBands(prices: number[], period = 20, stdDev = 2): BollingerBands {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0 }
  const slice = prices.slice(-period)
  const middle = slice.reduce((a, b) => a + b, 0) / period
  const squaredDiffs = slice.map((price) => (price - middle) ** 2)
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period
  const std = Math.sqrt(variance)
  return {
    upper: middle + std * stdDev,
    middle,
    lower: middle - std * stdDev,
  }
}

/** klines rows: Binance format [open time, open, high, low, close, ...] */
export function calculateATR(klines: number[][], period = 14): number {
  if (klines.length < period + 1) return 0
  const trs: number[] = []
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(String(klines[i][2]))
    const low = parseFloat(String(klines[i][3]))
    const prevClose = parseFloat(String(klines[i - 1][4]))
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)))
  }
  const recentTrs = trs.slice(-period)
  return recentTrs.reduce((a, b) => a + b, 0) / recentTrs.length
}

export function calculateOBV(closes: number[], volumes: number[]): ObvResult {
  if (closes.length < 2 || closes.length !== volumes.length) return { trend: 0, divergence: 'none' }
  let obv = 0
  const obvSeries = [0]
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i]
    else if (closes[i] < closes[i - 1]) obv -= volumes[i]
    obvSeries.push(obv)
  }
  const period = Math.min(14, obvSeries.length - 1)
  const recentObv = obvSeries.slice(-period)
  const recentPrice = closes.slice(-period)
  const obvTrend = recentObv[recentObv.length - 1] - recentObv[0]
  const priceTrend = recentPrice[recentPrice.length - 1] - recentPrice[0]
  let divergence: ObvResult['divergence'] = 'none'
  if (priceTrend > 0 && obvTrend < 0) divergence = 'bearish'
  if (priceTrend < 0 && obvTrend > 0) divergence = 'bullish'
  return { trend: obvTrend > 0 ? 1 : obvTrend < 0 ? -1 : 0, divergence }
}

export function detectRSIDivergence(prices: number[], period = 14, lookback = 5): 'none' | 'bullish' | 'bearish' {
  if (prices.length < period + lookback + 1) return 'none'
  const rsiSeries: number[] = []
  for (let end = period + 1; end <= prices.length; end++) {
    const slice = prices.slice(0, end)
    rsiSeries.push(calculateRSI(slice, period))
  }
  const recentPrices = prices.slice(-lookback)
  const recentRsi = rsiSeries.slice(-lookback)
  const priceDown = recentPrices[recentPrices.length - 1] < recentPrices[0]
  const rsiUp = recentRsi[recentRsi.length - 1] > recentRsi[0]
  const priceUp = recentPrices[recentPrices.length - 1] > recentPrices[0]
  const rsiDown = recentRsi[recentRsi.length - 1] < recentRsi[0]
  if (priceDown && rsiUp) return 'bullish'
  if (priceUp && rsiDown) return 'bearish'
  return 'none'
}
