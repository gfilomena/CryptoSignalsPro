// Statistics used by the analyzer. Pure, deterministic, dependency-free.
import type { AnalyzerConfig } from './config'

export const mean = (xs: ArrayLike<number>): number => {
  let s = 0
  for (let i = 0; i < xs.length; i++) s += xs[i]
  return xs.length ? s / xs.length : NaN
}

export function median(xs: ArrayLike<number>): number {
  const n = xs.length
  if (!n) return NaN
  const s = Array.from(xs).sort((a, b) => a - b)
  const m = n >> 1
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function stdev(xs: ArrayLike<number>): number {
  const n = xs.length
  if (n < 2) return NaN
  const m = mean(xs)
  let s = 0
  for (let i = 0; i < n; i++) s += (xs[i] - m) ** 2
  return Math.sqrt(s / (n - 1))
}

export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return NaN
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation, |error| < 1.5e-7). */
export function normalCdf(x: number): number {
  const s = x < 0 ? -1 : 1
  const a = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return 0.5 * (1 + s * y)
}

/**
 * Wilson score interval for a binomial proportion (k successes in n trials). Preferred over the Wald ±SD approximation:
 * it stays inside [0,1], has near-nominal coverage for small n and for p near 0/1.
 */
export function wilson(k: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (n <= 0) return { p: NaN, lo: NaN, hi: NaN }
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) }
}

/** Two-sided z-test of an observed frequency k/n against a reference proportion p0 (normal approximation; needs n·p0(1−p0) ≳ 5). */
export function binomialTwoSidedP(k: number, n: number, p0: number): number {
  if (n <= 0 || !(p0 > 0 && p0 < 1)) return 1
  const z = (k / n - p0) / Math.sqrt((p0 * (1 - p0)) / n)
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))))
}

/** One-sided version: P(observed ≥ k/n | true proportion p0). */
export function binomialUpperP(k: number, n: number, p0: number): number {
  if (n <= 0 || !(p0 > 0 && p0 < 1)) return 1
  const z = (k / n - p0) / Math.sqrt((p0 * (1 - p0)) / n)
  return 1 - normalCdf(z)
}

export type SampleClass = 'INSUFFICIENT' | 'LOW' | 'MODERATE' | 'STRONG'

/** Spec §9 classes on the effective N (defaults: <30 insufficient, 30–99 low, 100–299 moderate, ≥300 strong). */
export function sampleClass(n: number, cfg: Pick<AnalyzerConfig, 'minSample'>): SampleClass {
  if (n < cfg.minSample.low) return 'INSUFFICIENT'
  if (n < cfg.minSample.moderate) return 'LOW'
  if (n < cfg.minSample.strong) return 'MODERATE'
  return 'STRONG'
}

/**
 * Nearest-first de-clustering. Neighbouring 15-minute states are nearly the same observation, so counting all of them
 * overstates N. Analogs are visited in increasing distance (ties: earlier time) and kept only if they are at least
 * `gapMs` away from every analog already kept. Returns the kept positions (indices into the input arrays).
 */
export function decluster(times: ArrayLike<number>, dists: ArrayLike<number>, gapMs: number): number[] {
  const order = Array.from({ length: times.length }, (_, i) => i).sort((a, b) => dists[a] - dists[b] || times[a] - times[b])
  const keptTimes: number[] = [] // sorted ascending
  const keptIdx: number[] = []
  for (const i of order) {
    const t = times[i]
    // binary search insertion point
    let lo = 0
    let hi = keptTimes.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (keptTimes[mid] < t) lo = mid + 1
      else hi = mid
    }
    const left = lo > 0 ? keptTimes[lo - 1] : -Infinity
    const right = lo < keptTimes.length ? keptTimes[lo] : Infinity
    if (t - left >= gapMs && right - t >= gapMs) {
      keptTimes.splice(lo, 0, t)
      keptIdx.push(i)
    }
  }
  return keptIdx
}

/** Seeded PRNG (mulberry32) so every resampling in the module is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function bootstrapMeanCI(xs: ArrayLike<number>, seed = 12345, B = 1000): [number, number] {
  const n = xs.length
  if (n < 2) return [NaN, NaN]
  const rnd = mulberry32(seed)
  const means = new Array<number>(B)
  for (let b = 0; b < B; b++) {
    let s = 0
    for (let i = 0; i < n; i++) s += xs[Math.floor(rnd() * n)]
    means[b] = s / n
  }
  means.sort((a, b) => a - b)
  return [means[Math.floor(0.025 * B)], means[Math.floor(0.975 * B)]]
}
