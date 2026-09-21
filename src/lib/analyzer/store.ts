// Historical feature store: the precomputed market-state vectors (one per 15-minute observation) plus the 5-minute
// price bars needed to compute forward outcomes. Built offline by scripts/analyzer/buildStore.ts, shipped as one compact
// binary (public/analyzer/store.bin), decoded once in the worker and kept in memory — the browser never re-downloads
// or re-derives history per click.
import { BAR_MS } from './config'
import { FEATURE_NAMES } from './features'
import { fitScaler, transformMatrix, type Scaler } from './similarity'

export interface StoreMeta {
  version: string
  symbol: string
  featureNames: string[]
  /** number of observations (rows) */
  n: number
  /** number of 5-minute bars */
  nBars: number
  /** open time (ms) of bar 0 */
  t0Bars: number
  /** chronological 60/20/20 boundaries (ms) */
  trainEndMs: number
  valEndMs: number
  /** observation time of the last row that exists (≈ end of stored history) */
  dataEndMs: number
  dataStartMs: number
  /** τ0, calibrated outcome-free on train rows (see buildStore.ts) */
  thresholdBase: number
  /** per-feature quantisation step of the int16 matrix */
  quantScale: number[]
  builtAt: string
  source: string
}

export interface AnalyzerStore {
  meta: StoreMeta
  n: number
  F: number
  /** row observation times (ms), ascending, unique */
  times: Float64Array
  /** dequantised raw feature matrix (row-major n×F) */
  raw: Float32Array
  /** robust z-scored, clipped matrix used for distances */
  z: Float32Array
  scaler: Scaler
  bars: { t0: number; c: Float32Array; h: Float32Array; l: Float32Array }
  nTrain: number
}

/** FNV-1a 32-bit over the quantised matrix and times: a cheap deterministic content id for reproducibility records. */
export function contentVersion(q: Int16Array, times: Uint32Array): string {
  let h = 0x811c9dc5
  const feed = (x: number) => {
    h ^= x & 0xffff
    h = Math.imul(h, 0x01000193) >>> 0
  }
  for (let i = 0; i < q.length; i++) feed(q[i])
  for (let i = 0; i < times.length; i++) { feed(times[i] & 0xffff); feed(times[i] >>> 16) }
  return h.toString(16).padStart(8, '0')
}

export interface StoreInput {
  meta: Omit<StoreMeta, 'version' | 'quantScale' | 'n' | 'nBars' | 'featureNames'>
  times: number[] // ms, ascending
  rows: Float64Array[] // raw feature vectors, same order as times
  bars: { c: ArrayLike<number>; h: ArrayLike<number>; l: ArrayLike<number> }
}

function align4(n: number): number { return (n + 3) & ~3 }

export function encodeStore(inp: StoreInput): Uint8Array {
  const n = inp.rows.length
  const F = FEATURE_NAMES.length
  if (inp.times.length !== n) throw new Error('times/rows length mismatch')
  for (let i = 1; i < n; i++) if (!(inp.times[i] > inp.times[i - 1])) throw new Error('store times must be strictly increasing (duplicate or unordered row)')
  const quantScale = new Array<number>(F).fill(1e-9)
  for (let f = 0; f < F; f++) {
    let m = 0
    for (let r = 0; r < n; r++) m = Math.max(m, Math.abs(inp.rows[r][f]))
    quantScale[f] = Math.max(m / 32000, 1e-9)
  }
  const q = new Int16Array(n * F)
  for (let r = 0; r < n; r++) for (let f = 0; f < F; f++) q[r * F + f] = Math.round(inp.rows[r][f] / quantScale[f])
  const tMin = new Uint32Array(n)
  for (let r = 0; r < n; r++) tMin[r] = Math.round(inp.times[r] / 60_000)
  const nBars = inp.bars.c.length
  const meta: StoreMeta = { ...inp.meta, featureNames: FEATURE_NAMES, n, nBars, quantScale, version: contentVersion(q, tMin) }
  const head = new TextEncoder().encode(JSON.stringify(meta))
  const headLen = align4(head.length)
  const total = 8 + headLen + align4(q.byteLength) + tMin.byteLength + nBars * 4 * 3
  const buf = new ArrayBuffer(total)
  const u8 = new Uint8Array(buf)
  const dv = new DataView(buf)
  u8.set([0x43, 0x53, 0x50, 0x41], 0) // "CSPA"
  dv.setUint32(4, head.length, true)
  u8.set(head, 8)
  let o = 8 + headLen
  new Int16Array(buf, o, q.length).set(q)
  o += align4(q.byteLength)
  new Uint32Array(buf, o, n).set(tMin)
  o += tMin.byteLength
  for (const arr of [inp.bars.c, inp.bars.h, inp.bars.l]) {
    new Float32Array(buf, o, nBars).set(Array.from(arr as ArrayLike<number>))
    o += nBars * 4
  }
  return u8
}

export function decodeStore(bytes: Uint8Array | ArrayBuffer): AnalyzerStore {
  const buf = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes
  const u8 = new Uint8Array(buf)
  if (u8[0] !== 0x43 || u8[1] !== 0x53 || u8[2] !== 0x50 || u8[3] !== 0x41) throw new Error('not an analyzer store')
  const dv = new DataView(buf)
  const headLen = dv.getUint32(4, true)
  const meta = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + headLen))) as StoreMeta
  const F = meta.featureNames.length
  if (F !== FEATURE_NAMES.length || meta.featureNames.some((nme, i) => nme !== FEATURE_NAMES[i])) throw new Error('store feature layout does not match this build — rebuild the store')
  const n = meta.n
  let o = 8 + align4(headLen)
  const q = new Int16Array(buf.slice(o, o + n * F * 2))
  o += align4(n * F * 2)
  const tMin = new Uint32Array(buf.slice(o, o + n * 4))
  o += n * 4
  const read = () => { const a = new Float32Array(buf.slice(o, o + meta.nBars * 4)); o += meta.nBars * 4; return a }
  const c = read()
  const h = read()
  const l = read()
  const raw = new Float32Array(n * F)
  for (let r = 0; r < n; r++) for (let f = 0; f < F; f++) raw[r * F + f] = q[r * F + f] * meta.quantScale[f]
  const times = new Float64Array(n)
  for (let r = 0; r < n; r++) times[r] = tMin[r] * 60_000
  return prepareStore(meta, times, raw, { t0: meta.t0Bars, c, h, l })
}

/** Builds the in-memory store (scaler fitted on TRAIN rows only, z-matrix precomputed). */
export function prepareStore(meta: StoreMeta, times: Float64Array, raw: Float32Array, bars: AnalyzerStore['bars']): AnalyzerStore {
  const F = meta.featureNames.length
  const n = meta.n
  let nTrain = 0
  while (nTrain < n && times[nTrain] < meta.trainEndMs) nTrain++
  const scaler = fitScaler(raw, F, Math.max(nTrain, 1))
  const z = transformMatrix(scaler, raw, F, n)
  return { meta, n, F, times, raw, z, scaler, bars, nTrain }
}

/** Bar index of the bar whose CLOSE is the observation time `tMs`. */
export const barIndexOfObservation = (store: Pick<AnalyzerStore, 'bars'>, tMs: number): number => Math.round((tMs - BAR_MS - store.bars.t0) / BAR_MS)
