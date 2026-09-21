// Similarity between market states.
//
// Method: group-weighted Euclidean distance on robust z-scores.
//  * Robust z-score: (x − median) / (1.4826·MAD), fitted on TRAIN rows only, clipped to ±5. Market features (OI/volume/return
//    changes) are fat-tailed; mean/stdev scaling would let one crash dominate. Fitting on train only means no later data
//    leaks into the geometry of the space.
//  * Group weighting: each of the 7 feature groups contributes 1/7 of the squared distance, split evenly across its
//    features. Otherwise the 6 price and 6 OI features (which are strongly collinear) would drown funding/volume/regime.
//    Equal group weights are the uninformed prior: no weight was tuned on outcomes.
//  * distance d = sqrt( Σ_g (1/G) · mean_{f∈g} (z_f(now) − z_f(hist))² ) — an RMS z-gap, so d≈0 identical, d≈1 "typical
//    feature differs by one robust σ", d≈√2 for two independent draws.
// Rejected alternatives: plain Euclidean on raw values (scale-dependent), Mahalanobis (needs a stable covariance of
// heavily collinear, non-stationary features — unstable), percentile-rank distance (throws away magnitude in the tails,
// exactly where extreme setups live), cosine (ignores intensity).
import { FEATURES, FEATURE_GROUPS, type FeatureGroup } from './features'

export const Z_CLIP = 5
const MAD_TO_SIGMA = 1.4826

export interface Scaler { median: Float64Array; scale: Float64Array }

function medianOfColumn(col: Float64Array): number {
  const s = Array.from(col).sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[n >> 1] : (s[(n >> 1) - 1] + s[n >> 1]) / 2
}

/** Robust scaler fitted on rows [0, nFit) of a row-major n×F matrix. Categorical features keep median 0 / scale 1. */
export function fitScaler(raw: ArrayLike<number>, F: number, nFit: number): Scaler {
  const median = new Float64Array(F)
  const scale = new Float64Array(F).fill(1)
  const col = new Float64Array(nFit)
  for (let f = 0; f < F; f++) {
    if (!FEATURES[f].scaled) continue
    for (let r = 0; r < nFit; r++) col[r] = raw[r * F + f]
    const med = medianOfColumn(col)
    const dev = new Float64Array(nFit)
    for (let r = 0; r < nFit; r++) dev[r] = Math.abs(col[r] - med)
    let sc = MAD_TO_SIGMA * medianOfColumn(dev)
    if (!(sc > 1e-12)) {
      // degenerate MAD (feature is constant over more than half of the rows): fall back to the standard deviation
      let m = 0
      for (let r = 0; r < nFit; r++) m += col[r]
      m /= nFit
      let v = 0
      for (let r = 0; r < nFit; r++) v += (col[r] - m) ** 2
      sc = Math.sqrt(v / Math.max(1, nFit - 1))
    }
    median[f] = med
    scale[f] = sc > 1e-12 ? sc : 1
  }
  return { median, scale }
}

export function transformVector(sc: Scaler, x: ArrayLike<number>, out = new Float32Array(x.length)): Float32Array {
  for (let f = 0; f < x.length; f++) {
    if (!FEATURES[f].scaled) { out[f] = x[f]; continue }
    const z = (x[f] - sc.median[f]) / sc.scale[f]
    out[f] = z > Z_CLIP ? Z_CLIP : z < -Z_CLIP ? -Z_CLIP : z
  }
  return out
}

export function transformMatrix(sc: Scaler, raw: ArrayLike<number>, F: number, n: number): Float32Array {
  const z = new Float32Array(n * F)
  const row = new Float64Array(F)
  const tmp = new Float32Array(F)
  for (let r = 0; r < n; r++) {
    for (let f = 0; f < F; f++) row[f] = raw[r * F + f]
    transformVector(sc, row, tmp)
    z.set(tmp, r * F)
  }
  return z
}

/** Per-feature weight so that every group carries 1/G of the squared distance, split evenly inside the group. */
export const FEATURE_WEIGHTS: Float64Array = (() => {
  const w = new Float64Array(FEATURES.length)
  const G = FEATURE_GROUPS.length
  for (const grp of FEATURE_GROUPS) {
    const members = FEATURES.map((f, i) => (f.group === grp ? i : -1)).filter((i) => i >= 0)
    for (const i of members) w[i] = 1 / G / members.length
  }
  return w
})()

/** Group-weighted RMS z-distance between the query z-vector and row `r` of a z-matrix. */
export function distanceToRow(zq: ArrayLike<number>, z: ArrayLike<number>, r: number): number {
  const F = zq.length
  let s = 0
  const o = r * F
  for (let f = 0; f < F; f++) {
    const d = zq[f] - z[o + f]
    s += FEATURE_WEIGHTS[f] * d * d
  }
  return Math.sqrt(s)
}

/** Distance between two z-vectors (tests, diagnostics). */
export function distance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return distanceToRow(a, b, 0)
}

/** Per-group mean squared z-gap between the query and one row (for the "why is it similar" breakdown). */
export function groupGaps(zq: ArrayLike<number>, z: ArrayLike<number>, r: number): Record<FeatureGroup, number> {
  const F = zq.length
  const acc = {} as Record<FeatureGroup, number>
  const cnt = {} as Record<FeatureGroup, number>
  for (const g of FEATURE_GROUPS) { acc[g] = 0; cnt[g] = 0 }
  for (let f = 0; f < F; f++) {
    const d = zq[f] - z[r * F + f]
    acc[FEATURES[f].group] += d * d
    cnt[FEATURES[f].group]++
  }
  for (const g of FEATURE_GROUPS) acc[g] /= cnt[g]
  return acc
}
