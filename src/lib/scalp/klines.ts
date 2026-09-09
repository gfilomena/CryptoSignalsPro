import type { Candle } from '../../types/scalpSignal'

/** Fetches and parses Binance klines into typed Candle objects (spot public REST, no key needed). */
export async function fetchCandles(pair: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Binance klines ${res.status} for ${pair} ${interval}`)
  const raw = (await res.json()) as (string | number)[][]
  return raw.map((k) => ({
    openTime: Number(k[0]),
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
    closeTime: Number(k[6]),
  }))
}
