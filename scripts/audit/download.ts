// Downloads the historical Binance datasets used by the signal-engine audit from the official
// bulk archive (data.binance.vision) and caches them on disk (.audit-cache/, git-ignored). Bulk
// archive files are immutable once published, so a re-run is fully reproducible.
//
//   npx tsx scripts/audit/download.ts [--from=2023-09] [--to=2026-08]
//
// Datasets: spot klines 15m/1h/4h (what the scalp engine trades on: api.binance.com), USDT-M futures
// klines 15m/1h (what Smart Alerts use: fapi.binance.com), USDT-M futures "metrics" (open interest
// snapshots every 5 min), USDT-M futures funding-rate history.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CACHE = join(process.cwd(), '.audit-cache')
const BASE = 'https://data.binance.vision/data'
const PAIR = 'BTCUSDT'

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
}

export function months(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

function days(from: string, to: string): string[] {
  const out: string[] = []
  const start = new Date(`${from}-01T00:00:00Z`)
  const [ty, tm] = to.split('-').map(Number)
  const end = new Date(Date.UTC(ty, tm, 0)) // last day of `to`
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) out.push(d.toISOString().slice(0, 10))
  return out
}

async function fetchCsv(url: string, cacheName: string): Promise<string> {
  const path = join(CACHE, 'raw', cacheName)
  if (existsSync(path)) return readFileSync(path, 'utf8')
  const res = await fetch(url)
  if (res.status === 404) return ''
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const zip = Buffer.from(await res.arrayBuffer())
  const tmp = join(CACHE, 'raw', `${cacheName}.zip`)
  writeFileSync(tmp, zip)
  const csv = execFileSync('unzip', ['-p', tmp], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8')
  writeFileSync(path, csv)
  return csv
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/** Spot archives switched to microsecond timestamps in 2025; normalise everything to ms. */
const toMs = (t: number): number => (t > 1e14 ? Math.floor(t / 1000) : t)

export interface Kline { t: number; o: number; h: number; l: number; c: number; v: number; ct: number }

export async function klines(market: 'spot' | 'futures/um', interval: string, ms: string[]): Promise<Kline[]> {
  const parts = await pool(ms, 6, async (m) => {
    const csv = await fetchCsv(`${BASE}/${market}/monthly/klines/${PAIR}/${interval}/${PAIR}-${interval}-${m}.zip`, `${market.replace('/', '_')}-klines-${interval}-${m}.csv`)
    return csv.split('\n').filter((l) => /^\d/.test(l)).map((l) => {
      const f = l.split(',')
      return { t: toMs(Number(f[0])), o: +f[1], h: +f[2], l: +f[3], c: +f[4], v: +f[5], ct: toMs(Number(f[6])) }
    })
  })
  return parts.flat().sort((a, b) => a.t - b.t)
}

async function main() {
  mkdirSync(join(CACHE, 'raw'), { recursive: true })
  const from = arg('from', '2023-09')
  const to = arg('to', '2026-08')
  const ms = months(from, to)
  const out: Record<string, unknown> = { pair: PAIR, from, to }

  for (const iv of ['15m', '1h', '4h']) {
    out[`spot_${iv}`] = await klines('spot', iv, ms)
    console.log(`spot ${iv}:`, (out[`spot_${iv}`] as Kline[]).length)
  }
  for (const iv of ['5m', '15m', '1h', '4h']) {
    out[`fut_${iv}`] = await klines('futures/um', iv, ms)
    console.log(`futures ${iv}:`, (out[`fut_${iv}`] as Kline[]).length)
  }

  const fundingParts = await pool(ms, 6, async (m) => {
    const csv = await fetchCsv(`${BASE}/futures/um/monthly/fundingRate/${PAIR}/${PAIR}-fundingRate-${m}.zip`, `fut-funding-${m}.csv`)
    return csv.split('\n').filter((l) => /^\d/.test(l)).map((l) => {
      const f = l.split(',')
      return { t: Number(f[0]), intervalH: Number(f[1]), rate: Number(f[2]) }
    })
  })
  out.funding = fundingParts.flat().sort((a, b) => a.t - b.t)
  console.log('funding points:', (out.funding as unknown[]).length)

  const dayList = days(from, to)
  const oiParts = await pool(dayList, 12, async (d) => {
    const csv = await fetchCsv(`${BASE}/futures/um/daily/metrics/${PAIR}/${PAIR}-metrics-${d}.zip`, `fut-metrics-${d}.csv`)
    return csv.split('\n').filter((l) => /^\d{4}-/.test(l)).map((l) => {
      const f = l.split(',')
      return { t: Date.parse(`${f[0].replace(' ', 'T')}Z`), oi: Number(f[2]), oiUsd: Number(f[3]) }
    })
  })
  out.oi = oiParts.flat().filter((p) => Number.isFinite(p.oi)).sort((a, b) => a.t - b.t)
  console.log('oi points (5m):', (out.oi as unknown[]).length)

  writeFileSync(join(CACHE, 'dataset.json'), JSON.stringify(out))
  console.log('written', join(CACHE, 'dataset.json'))
}

if (process.argv[1]?.endsWith('download.ts')) main().catch((e) => { console.error(e); process.exit(1) })
