// Historical, walk-forward backtest runner for the prudent-mode scalping engine. Fetches real
// Binance candles for the three configured timeframes (trend/structure/entry) and runs the exact
// same runBacktest() used by the unit tests — no separate "backtest approximation" of the
// strategy. Prints a plain-text report: number of trades, win rate, profit factor, expectancy,
// max drawdown, average R:R, signals/day, and no-trade days.
//
// Usage:
//   npx tsx scripts/run-scalp-backtest.ts [--pair=BTCUSDT] [--days=60]
//
// Requires outbound network access to api.binance.com (this script fetches real market data —
// it cannot run inside a network-restricted sandbox).
import { runBacktest } from '../src/lib/scalp/backtest'
import { DEFAULT_STRATEGY_CONFIG } from '../src/config/strategyConfig'
import type { Candle } from '../src/types/scalpSignal'

const TIMEFRAME_MS: Record<string, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
}

function parseArgs(): { pair: string; days: number } {
  const args = process.argv.slice(2)
  const get = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
  return { pair: get('pair', 'BTCUSDT'), days: Number(get('days', '60')) }
}

/** Paginates Binance's 1000-candle-per-request limit by walking backwards from now. */
async function fetchHistoricalCandles(pair: string, interval: string, days: number): Promise<Candle[]> {
  const stepMs = TIMEFRAME_MS[interval]
  if (!stepMs) throw new Error(`Unknown interval ${interval}`)
  const totalNeeded = Math.ceil((days * 24 * 60 * 60_000) / stepMs) + 50 // small buffer for warmup
  const out: Candle[] = []
  let endTime = Date.now()

  while (out.length < totalNeeded) {
    const limit = Math.min(1000, totalNeeded - out.length)
    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}&endTime=${endTime}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Binance klines ${res.status} for ${pair} ${interval}`)
    const raw = (await res.json()) as (string | number)[][]
    if (raw.length === 0) break
    const batch: Candle[] = raw.map((k) => ({
      openTime: Number(k[0]),
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[5])),
      closeTime: Number(k[6]),
    }))
    out.unshift(...batch)
    endTime = batch[0].openTime - 1
    if (raw.length < limit) break // exhausted available history
  }
  return out
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n)
}

async function main() {
  const { pair, days } = parseArgs()
  const config = DEFAULT_STRATEGY_CONFIG

  console.log(`Fetching ${days} days of ${pair} candles (${config.trendTimeframe}/${config.structureTimeframe}/${config.entryTimeframe})...`)
  const [trendCandles, structureCandles, entryCandles] = await Promise.all([
    fetchHistoricalCandles(pair, config.trendTimeframe, days),
    fetchHistoricalCandles(pair, config.structureTimeframe, days),
    fetchHistoricalCandles(pair, config.entryTimeframe, days),
  ])
  console.log(`Fetched: ${trendCandles.length} ${config.trendTimeframe}, ${structureCandles.length} ${config.structureTimeframe}, ${entryCandles.length} ${config.entryTimeframe} candles.`)

  const result = runBacktest(trendCandles, structureCandles, entryCandles, config)
  const s = result.stats

  console.log('\n=== Prudent-mode backtest report ===')
  console.log(`Period: ~${days} days | Pair: ${pair}`)
  console.log(`Total simulated days: ${result.totalDays}`)
  console.log(`Days with at least one trade: ${result.daysWithATrade}`)
  console.log(`No-trade days: ${result.noTradeDays} (${fmt((result.noTradeDays / Math.max(result.totalDays, 1)) * 100, 1)}%)`)
  console.log(`Signals (entries) per day: ${fmt(result.signalsPerDay, 3)}`)
  console.log('---')
  console.log(`Total trades: ${s.totalTrades}`)
  console.log(`Wins / Losses: ${s.wins} / ${s.losses}`)
  console.log(`Win rate: ${fmt(s.winRate, 1)}%`)
  console.log(`Profit factor: ${fmt(s.profitFactor)}`)
  console.log(`Expectancy (avg PnL/trade): ${fmt(s.expectancy)} ${config.capitalCurrency.toUpperCase()}`)
  console.log(`Avg win / Avg loss: ${fmt(s.avgWin)} / ${fmt(s.avgLoss)} ${config.capitalCurrency.toUpperCase()}`)
  console.log(`Avg R:R realized: ${fmt(s.avgRR)}`)
  console.log(`Max drawdown: ${fmt(s.maxDrawdown)} ${config.capitalCurrency.toUpperCase()}`)
  console.log(`Total PnL: ${fmt(s.totalPnl)} ${config.capitalCurrency.toUpperCase()}`)
  console.log('=====================================')
  console.log(
    '\nReminder: this is a diagnostic score of historical mechanics, not a guarantee. Do not treat a positive result as proof of future profitability — validate across bull, bear, sideways, and high/low volatility periods before trusting this engine with real capital.',
  )
}

main().catch((err) => {
  console.error('Backtest failed:', err)
  process.exit(1)
})
