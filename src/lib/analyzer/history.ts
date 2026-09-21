// Snapshot history + post-event validation: every analysis is stored (local-first, best-effort Supabase sync like Smart Alerts),
// and later resolved against what the market actually did after T. The dashboard numbers come from these REAL outcomes.
import { BAR_MS, HORIZONS } from './config'
import type { AnalyzerResult, Bias } from './analyzer'
import type { AnalyzerSnapshot, SnapshotDisplay } from './liveSnapshot'
import { pathOutcome } from './outcomes'
import { mean, median } from './stats'
import { SUPABASE_URL, hasSupabaseConfig } from '../../config/env'
import { restHeaders, restUrl } from '../smartAlerts/api'

export const OUTCOME_HORIZONS = ['5m', '15m', '30m', '1h', '4h', '24h'] as const
export type Alignment = 'ALIGNED' | 'CONFLICTING' | 'NOT_COMPARABLE'

export interface OutcomeRecord { ret: number; mfe: number; mae: number; maxDrawdown: number; resolvedAt: number }

export interface AnalysisRecord {
  id: string
  createdAt: number
  snapshotTimeMs: number
  symbol: string
  entryPrice: number
  display: SnapshotDisplay
  vector: number[]
  storeVersion: string
  tau: number
  windowDays: number | null
  nAnalogs: number
  bias: Bias
  strength: number | null
  confirmation: string
  horizons: { horizon: string; nEff: number; pPositive: number; lo: number; hi: number }[]
  engineState: string | null
  alignment: Alignment
  outcomes: Record<string, OutcomeRecord>
}

const KEY = 'csp_setup_analyses_v1'
const MAX = 500

/** Agreement between the automatic Signal Engine and the analyzer's historical bias. Conflicts are shown, never resolved. */
export function alignment(engineDirection: 'long' | 'short' | null, engineIsFlat: boolean, bias: Bias): Alignment {
  if (bias === 'INSUFFICIENT') return 'NOT_COMPARABLE'
  const engine = engineDirection === 'long' ? 'BULLISH' : engineDirection === 'short' ? 'BEARISH' : engineIsFlat ? 'WAIT' : null
  if (engine === null) return 'NOT_COMPARABLE'
  if (engine === 'WAIT') return bias === 'NEUTRAL' ? 'ALIGNED' : 'CONFLICTING'
  if (bias === 'NEUTRAL') return 'CONFLICTING'
  return engine === bias ? 'ALIGNED' : 'CONFLICTING'
}

export function makeRecord(snapshot: AnalyzerSnapshot, result: AnalyzerResult, engine: { state: string | null; direction: 'long' | 'short' | null; flat: boolean }, now = Date.now()): AnalysisRecord {
  return {
    id: `${snapshot.t}-${Math.abs(hash(snapshot.vector.join(','))).toString(36)}-${now.toString(36)}`,
    createdAt: now,
    snapshotTimeMs: snapshot.t,
    symbol: 'BTCUSDT',
    entryPrice: snapshot.entryPrice,
    display: snapshot.display,
    vector: snapshot.vector,
    storeVersion: result.storeVersion,
    tau: result.tau,
    windowDays: result.windowDays,
    nAnalogs: result.nAnalogs,
    bias: result.bias,
    strength: result.strength,
    confirmation: result.confirmation,
    horizons: result.horizons.map((h) => ({ horizon: h.horizon, nEff: h.nEff, pPositive: h.pPositive.p, lo: h.pPositive.lo, hi: h.pPositive.hi })),
    engineState: engine.state,
    alignment: alignment(engine.direction, engine.flat, result.bias),
    outcomes: {},
  }
}

function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0
  return h
}

// ---- local persistence ---------------------------------------------------------------------------------------------
export function loadRecords(): AnalysisRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as AnalysisRecord[]) : []
  } catch {
    return []
  }
}

export function saveRecords(records: AnalysisRecord[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(records.slice(0, MAX)))
  } catch {
    /* quota: history is a convenience, never block the analysis */
  }
}

export function addRecord(records: AnalysisRecord[], rec: AnalysisRecord): AnalysisRecord[] {
  const next = [rec, ...records.filter((r) => r.id !== rec.id)].slice(0, MAX)
  saveRecords(next)
  return next
}

// ---- best-effort remote sync (table setup_analyses(id text pk, created_at timestamptz, data jsonb)) ---------------------
export async function pushRemote(rec: AnalysisRecord): Promise<void> {
  if (!hasSupabaseConfig) return
  try {
    await fetch(restUrl('/setup_analyses?on_conflict=id'), {
      method: 'POST',
      headers: restHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ id: rec.id, created_at: new Date(rec.createdAt).toISOString(), data: rec }),
    })
  } catch {
    /* local copy already saved */
  }
}

export async function pullRemote(): Promise<AnalysisRecord[]> {
  if (!hasSupabaseConfig || !SUPABASE_URL) return []
  try {
    const res = await fetch(restUrl('/setup_analyses?select=data&order=created_at.desc&limit=500'), { headers: restHeaders() })
    if (!res.ok) return []
    return ((await res.json()) as { data: AnalysisRecord }[]).map((r) => r.data)
  } catch {
    return []
  }
}

export function mergeRecords(local: AnalysisRecord[], remote: AnalysisRecord[]): AnalysisRecord[] {
  const byId = new Map<string, AnalysisRecord>()
  for (const r of [...remote, ...local]) {
    const prev = byId.get(r.id)
    // keep the copy with more resolved outcomes
    if (!prev || Object.keys(r.outcomes).length >= Object.keys(prev.outcomes).length) byId.set(r.id, r)
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX)
}

// ---- post-event validation -----------------------------------------------------------------------------------------
export interface FuturePath { h: number[]; l: number[]; c: number[] }

/** Fetches the 5-minute futures bars that opened at or after `fromMs` (closed bars only), for outcome resolution. */
export async function fetchFuturePath(fromMs: number, now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<FuturePath> {
  const res = await fetchImpl(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&startTime=${fromMs}&limit=300`)
  if (!res.ok) throw new Error(`klines_${res.status}`)
  const raw = (await res.json()) as (string | number)[][]
  const closed = raw.filter((k) => Number(k[6]) < now)
  return { h: closed.map((k) => parseFloat(String(k[2]))), l: closed.map((k) => parseFloat(String(k[3]))), c: closed.map((k) => parseFloat(String(k[4]))) }
}

/** Resolves every outcome horizon whose time has passed. Same definition as the historical analogs: return from the CLOSE of the observation bar. */
export function resolveRecord(rec: AnalysisRecord, path: FuturePath, now = Date.now()): AnalysisRecord {
  const outcomes = { ...rec.outcomes }
  for (const label of OUTCOME_HORIZONS) {
    if (outcomes[label]) continue
    const H = HORIZONS.find((x) => x.label === label)!.bars
    if (now < rec.snapshotTimeMs + H * BAR_MS) continue
    const o = pathOutcome(rec.entryPrice, path.h, path.l, path.c, 0, H)
    if (o) outcomes[label] = { ret: o.ret, mfe: o.mfe, mae: o.mae, maxDrawdown: o.maxDrawdown, resolvedAt: now }
  }
  return { ...rec, outcomes }
}

export const needsResolution = (rec: AnalysisRecord, now = Date.now()): boolean =>
  OUTCOME_HORIZONS.some((label) => !rec.outcomes[label] && now >= rec.snapshotTimeMs + HORIZONS.find((x) => x.label === label)!.bars * BAR_MS)

export async function resolveAll(records: AnalysisRecord[], now = Date.now(), pathFetcher: (fromMs: number) => Promise<FuturePath> = (f) => fetchFuturePath(f, now)): Promise<{ records: AnalysisRecord[]; changed: AnalysisRecord[] }> {
  const changed: AnalysisRecord[] = []
  const out: AnalysisRecord[] = []
  for (const rec of records) {
    if (!needsResolution(rec, now)) { out.push(rec); continue }
    try {
      const next = resolveRecord(rec, await pathFetcher(rec.snapshotTimeMs), now)
      if (Object.keys(next.outcomes).length !== Object.keys(rec.outcomes).length) changed.push(next)
      out.push(next)
    } catch {
      out.push(rec) // transient failure: try again next time
    }
  }
  return { records: out, changed }
}

// ---- performance dashboard -------------------------------------------------------------------------------------------
export interface HorizonPerf { resolved: number; pPositive: number | null; pNegative: number | null; meanRet: number | null; medianRet: number | null }
export interface PerformanceSummary {
  total: number
  bullish: number
  bearish: number
  neutral: number
  insufficient: number
  byHorizon: Record<string, HorizonPerf>
  /** realised results split by the bias the analyzer showed */
  byBias: Record<'BULLISH' | 'BEARISH' | 'NEUTRAL', Record<string, HorizonPerf>>
}

function perf(rets: number[]): HorizonPerf {
  return {
    resolved: rets.length,
    pPositive: rets.length ? rets.filter((x) => x > 0).length / rets.length : null,
    pNegative: rets.length ? rets.filter((x) => x < 0).length / rets.length : null,
    meanRet: rets.length ? mean(rets) : null,
    medianRet: rets.length ? median(rets) : null,
  }
}

export function summarizePerformance(records: AnalysisRecord[]): PerformanceSummary {
  const byHorizon: Record<string, HorizonPerf> = {}
  const byBias = { BULLISH: {}, BEARISH: {}, NEUTRAL: {} } as PerformanceSummary['byBias']
  for (const h of OUTCOME_HORIZONS) {
    byHorizon[h] = perf(records.filter((r) => r.outcomes[h]).map((r) => r.outcomes[h].ret))
    for (const b of ['BULLISH', 'BEARISH', 'NEUTRAL'] as const) byBias[b][h] = perf(records.filter((r) => r.bias === b && r.outcomes[h]).map((r) => r.outcomes[h].ret))
  }
  return {
    total: records.length,
    bullish: records.filter((r) => r.bias === 'BULLISH').length,
    bearish: records.filter((r) => r.bias === 'BEARISH').length,
    neutral: records.filter((r) => r.bias === 'NEUTRAL').length,
    insufficient: records.filter((r) => r.bias === 'INSUFFICIENT').length,
    byHorizon,
    byBias,
  }
}
