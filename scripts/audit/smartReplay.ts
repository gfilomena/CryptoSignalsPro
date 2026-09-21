// Chronological replay of the Smart Alerts engine (src/lib/smartAlerts/*) on 5-minute steps.
// Every step rebuilds the MetricSnapshot exactly as fetchSmartAlertSnapshot would have seen it at that
// wall-clock time, using ONLY data published at or before it:
//   PRICE               close of the 5m futures bar that just closed
//   PRICE_CHANGE        24h ROLLING change (Binance ticker/24hr semantics: last vs price 24h ago) — NOT a short-term change
//   OPEN_INTEREST_CHANGE(tf) latest two openInterestHist boundary points, published with the same lag the live API shows
//                       (verified live: at 10:11 the 15m series ends at the 10:00 point, 5m at 10:05)
//   FUNDING_RATE        lastFundingRate = last SETTLED 8h rate (premiumIndex), not the predicted one
//   RSI(tf)             last closed closes + the still-forming candle's current price (live fetches 200 candles, last is forming)
//   VOLUME_CHANGE(tf)   two most recently CLOSED candles
// The alert state machine is the real processAlert() from conditionEngine.ts.
import type { Dataset } from './lib'
import type { AlertCondition, MetricSnapshot, SmartAlert } from '../../src/types/smartAlert'
import { calculateRSI } from '../../src/lib/indicators'
import { createAlertFromPreset, getPreset, type PresetId } from '../../src/lib/smartAlerts/presets'
import { processAlert } from '../../src/lib/smartAlerts/conditionEngine'

const M5 = 5 * 60_000
const TF_MS: Record<string, number> = { '5m': M5, '15m': 15 * 60_000, '1h': 3_600_000, '4h': 4 * 3_600_000 }
/** openInterestHist points are visible ~1 min after their boundary at the earliest; be conservative. */
const OI_PUBLISH_LAG = 60_000

export interface SnapshotSeries {
  /** step index -> wall-clock time T (close of the 5m bar) */
  t: number[]
  snapshots: MetricSnapshot[]
  /** step index -> bar index in ds.fut_5m */
  barIndex: number[]
  /** short-term (1h) price change and 1h OI change, for descriptive quadrant analysis (NOT alert inputs) */
  ret1h: number[]
  oi1hChange: number[]
}

export function buildSnapshotSeries(ds: Dataset): SnapshotSeries {
  const f5 = ds.fut_5m
  const oiMap = new Map<number, number>()
  for (const p of ds.oi) if (p.oi > 0) oiMap.set(p.t, p.oi)
  const f15 = ds.fut_15m
  const f1h = ds.fut_1h
  const funding = ds.funding

  let p15 = -1
  let p1h = -1
  let pf = -1
  const t: number[] = []
  const snapshots: MetricSnapshot[] = []
  const barIndex: number[] = []
  const ret1h: number[] = []
  const oi1hChange: number[] = []

  const oiChange = (T: number, tf: string): number | null => {
    const ms = TF_MS[tf]
    const A = T - OI_PUBLISH_LAG
    const t1 = Math.floor(A / ms) * ms
    const a = oiMap.get(t1 - ms)
    const b = oiMap.get(t1)
    if (a === undefined || b === undefined) return null
    return ((b - a) / a) * 100
  }

  for (let i = 0; i < f5.length; i++) {
    const T = f5[i].ct + 1
    while (p15 + 1 < f15.length && f15[p15 + 1].ct + 1 <= T) p15++
    while (p1h + 1 < f1h.length && f1h[p1h + 1].ct + 1 <= T) p1h++
    while (pf + 1 < funding.length && funding[pf + 1].t <= T) pf++
    if (i < 288 || p1h < 20 || p15 < 3 || pf < 0) continue

    const price = f5[i].c
    const price24hAgo = f5[i - 288].c
    const closes1h = f1h.slice(p1h - 13, p1h + 1).map((k) => k.c)
    const rsi1h = calculateRSI([...closes1h, price], 14)
    const vprev = f15[p15 - 1].v
    const vlast = f15[p15].v
    const volChange15 = vprev > 0 ? ((vlast - vprev) / vprev) * 100 : null

    snapshots.push({
      symbol: 'BTC',
      timestamp: T,
      price,
      priceChangePct: ((price - price24hAgo) / price24hAgo) * 100,
      openInterest: null,
      openInterestChangePct: { '5m': oiChange(T, '5m'), '15m': oiChange(T, '15m'), '1h': oiChange(T, '1h'), '4h': oiChange(T, '4h') },
      fundingRate: funding[pf].rate * 100,
      volume: null,
      volumeChangePct: { '15m': volChange15 },
      rsi: { '1h': rsi1h },
      longLiquidations: null,
      shortLiquidations: null,
      liquidationSpike: null,
    })
    t.push(T)
    barIndex.push(i)
    ret1h.push((price / f5[i - 12].c - 1) * 100)
    oi1hChange.push(oiChange(T, '1h') ?? NaN)
  }
  return { t, snapshots, barIndex, ret1h, oi1hChange }
}

export interface SmartEvent {
  kind: 'fired' | 'invalidated'
  step: number
  /** bar index in ds.fut_5m */
  i: number
  t: number
  /** invalidation only: had the streak that just ended ITSELF produced a notification? */
  streakHadFired?: boolean
}

export interface RunOptions {
  presetId: PresetId
  /** consecutive matching steps required (live default is 2 cycles of 1 minute ≈ 1 step of 5 minutes) */
  confirmationCycles?: number
  /** override the conditions (ablation / sensitivity) */
  conditions?: Array<Omit<AlertCondition, 'id' | 'enabled'>>
  /** step index range to evaluate (inclusive-exclusive) — lets callers split chronologically */
  fromT?: number
  toT?: number
}

export function runSmartAlert(series: SnapshotSeries, o: RunOptions): SmartEvent[] {
  const base: SmartAlert = createAlertFromPreset(o.presetId, getPreset(o.presetId).id, { symbol: 'BTC', mode: 'ALWAYS', now: 0 })
  let alert: SmartAlert = {
    ...base,
    confirmationCycles: o.confirmationCycles ?? 1,
    conditions: (o.conditions ?? getPreset(o.presetId).conditions).map((c, k) => ({ ...c, id: `c${k}`, enabled: true })),
  }
  const events: SmartEvent[] = []
  let streakHadFired = false
  for (let s = 0; s < series.t.length; s++) {
    const T = series.t[s]
    if (o.fromT !== undefined && T < o.fromT) continue
    if (o.toT !== undefined && T >= o.toT) break
    const r = processAlert(alert, series.snapshots[s], T)
    const next: SmartAlert = { ...alert, pendingMatchCount: r.nextPendingMatchCount }
    if (r.shouldFire) {
      next.lastTriggeredAt = T
      streakHadFired = true
      events.push({ kind: 'fired', step: s, i: series.barIndex[s], t: T })
    } else if (r.shouldInvalidate) {
      next.lastInvalidatedAt = T
      events.push({ kind: 'invalidated', step: s, i: series.barIndex[s], t: T, streakHadFired })
    }
    if (r.nextPendingMatchCount === 0) streakHadFired = false
    alert = next
  }
  return events
}
