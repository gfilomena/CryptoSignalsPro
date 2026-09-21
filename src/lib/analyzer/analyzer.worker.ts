/// <reference lib="webworker" />
// Runs the store decode and the similarity search off the UI thread. The decoded store stays in memory between clicks,
// so "Analyze Setup" costs one pass over ~100k precomputed vectors (tens of milliseconds), not a re-download or re-derivation.
import { analyze, type AnalyzerResult } from './analyzer'
import { DEFAULT_CONFIG, type AnalyzerConfig } from './config'
import { decodeStore, type AnalyzerStore, type StoreMeta } from './store'

export interface ValidationFile {
  generatedAt: string
  storeVersion: string
  tau0: number
  oosValidity: number
  oosValidityRule: string
  splits: Record<'train' | 'val' | 'oos', [number, number]>
  results: Record<'train' | 'val' | 'oos', { queries: number; nonInsufficient: number; coverage: number; horizons: Record<string, unknown> }>
}

export type WorkerRequest =
  | { id: number; type: 'init'; storeUrl: string; validationUrl: string }
  | { id: number; type: 'analyze'; t: number; vector: number[]; windowDays: number | null }

export type WorkerResponse =
  | { id: number; ok: true; type: 'ready'; meta: StoreMeta; validation: ValidationFile | null }
  | { id: number; ok: true; type: 'result'; result: AnalyzerResult }
  | { id: number; ok: false; error: string }

let store: AnalyzerStore | null = null
let validation: ValidationFile | null = null

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data
  try {
    if (m.type === 'init') {
      if (!store) {
        const res = await fetch(m.storeUrl, { cache: 'no-cache' })
        if (!res.ok) throw new Error(`store_${res.status}`)
        store = decodeStore(await res.arrayBuffer())
        try {
          const v = await fetch(m.validationUrl, { cache: 'no-cache' })
          validation = v.ok ? ((await v.json()) as ValidationFile) : null
        } catch {
          validation = null
        }
      }
      ;(self as unknown as Worker).postMessage({ id: m.id, ok: true, type: 'ready', meta: store.meta, validation } satisfies WorkerResponse)
      return
    }
    if (!store) throw new Error('store_not_loaded')
    const cfg: AnalyzerConfig = { ...DEFAULT_CONFIG, thresholdBase: store.meta.thresholdBase, windowDays: m.windowDays }
    // the validity component is only meaningful for the store version it was measured on
    const oosValidity = validation && validation.storeVersion === store.meta.version ? validation.oosValidity : null
    const result = analyze(store, { t: m.t, vector: m.vector }, cfg, { oosValidity })
    ;(self as unknown as Worker).postMessage({ id: m.id, ok: true, type: 'result', result } satisfies WorkerResponse)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id: m.id, ok: false, error: (err as Error).message } satisfies WorkerResponse)
  }
}
