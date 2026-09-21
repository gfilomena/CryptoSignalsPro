// Promise API over the analyzer worker (created lazily, one instance for the page).
import type { AnalyzerResult } from './analyzer'
import type { StoreMeta } from './store'
import type { ValidationFile, WorkerRequest, WorkerResponse } from './analyzer.worker'

export type { ValidationFile }

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>()
let ready: Promise<{ meta: StoreMeta; validation: ValidationFile | null }> | null = null

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.ok) p.resolve(e.data)
    else p.reject(new Error(e.data.error))
  }
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'worker_error'))
    pending.clear()
    worker = null
    ready = null
  }
  return worker
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

function call(req: DistributiveOmit<WorkerRequest, 'id'>): Promise<WorkerResponse> {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ ...req, id } as WorkerRequest)
  })
}

const base = () => (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')

/** Loads (once) the historical feature store and the shipped validation summary. */
export function initAnalyzer(): Promise<{ meta: StoreMeta; validation: ValidationFile | null }> {
  if (!ready) {
    ready = call({ type: 'init', storeUrl: `${base()}analyzer/store.bin`, validationUrl: `${base()}analyzer/validation.json` })
      .then((r) => {
        if (r.ok && r.type === 'ready') return { meta: r.meta, validation: r.validation }
        throw new Error('init_failed')
      })
      .catch((e) => {
        ready = null
        throw e
      })
  }
  return ready
}

export async function runAnalysis(t: number, vector: number[], windowDays: number | null): Promise<AnalyzerResult> {
  await initAnalyzer()
  const r = await call({ type: 'analyze', t, vector, windowDays })
  if (r.ok && r.type === 'result') return r.result
  throw new Error('analysis_failed')
}
