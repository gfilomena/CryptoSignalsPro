// Setup Strength: 0–100 measure of how strong the HISTORICAL EVIDENCE for the current setup is. It is not a probability of
// profit and not a trade recommendation.
//
// Six components, each in [0,1]. Five of them measure the IN-SAMPLE evidence for the current setup; the sixth measures whether
// that kind of evidence has ever predicted anything OUT OF SAMPLE. They are combined as
//     S_in     = (S_n · S_sim · S_sep · S_cons · S_rob)^(1/5)      geometric mean: evidence is only as strong as its weakest link
//     strength = 100 · S_in · S_oos                                 in-sample evidence, discounted by demonstrated out-of-sample validity
// Why the discount is multiplicative and not one more geometric-mean term: a root-of-6 mean lets a method with NO out-of-sample skill
// (S_oos ≈ 0.18) still score "moderate" (0.18^(1/6) = 0.75). A beautiful in-sample pattern from a method that fails out of sample
// must not read as moderate evidence; with the product it is capped at 100·S_oos. No subjective point weights are used.
//
//  S_n    sample size:    min(1, ln(1+n_eff) / ln(1+N_strong)), n_eff = median effective N over the bias horizons
//  S_sim  match quality:  1 − mean(distance of the analogs) / median(distance of ALL candidate states); how much closer
//                         than an arbitrary historical state the analogs are (0 = no closer than random)
//  S_sep  separation:     mean over bias horizons of E(p), p = two-sided binomial test of the analogs' positive-return
//                         frequency against the unconditional frequency (evidence that the setup differs from "any time")
//  S_cons consistency:    share of the 5 displayed horizons whose deviation from baseline has the same sign as the bias
//  S_rob  robustness:     share of similarity-threshold variants (0.8/0.9/1.0/1.1 × τ0) that give the same bias
//  S_oos  method validity: E(p), p = one-sided test that the analyzer's OUT-OF-SAMPLE directional accuracy beat the best
//                         constant guess (from the shipped chronological validation); 0 when no validation exists
//
// E(p) = min(1, −log10(p) / 3): evidence on the log scale of the p-value, saturating at p = 0.001 ("very strong"). p = 0.05 →
// 0.43, p = 0.30 → 0.18, p ≥ 1 → 0. (1 − p would read a non-significant p = 0.30 as "70 % evidence", which it is not.)
import type { AnalyzerConfig } from './config'

export interface StrengthComponents { n: number; sim: number; sep: number; cons: number; rob: number; oos: number }

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0)

/** Evidence in [0,1] from a p-value: −log10(p)/3, saturating at p = 0.001. */
export function evidenceFromP(p: number): number {
  if (!Number.isFinite(p)) return 0
  return clamp01(-Math.log10(Math.max(p, 1e-12)) / 3)
}

export function strengthFromComponents(c: StrengthComponents): number {
  const inSample = [c.n, c.sim, c.sep, c.cons, c.rob].map(clamp01)
  const oos = clamp01(c.oos)
  if (oos === 0 || inSample.some((p) => p === 0)) return 0
  const sIn = Math.exp(inSample.reduce((a, p) => a + Math.log(p), 0) / inSample.length)
  return Math.round(100 * sIn * oos * 10) / 10
}

export function sampleComponent(nEff: number, cfg: Pick<AnalyzerConfig, 'minSample'>): number {
  return clamp01(Math.log(1 + nEff) / Math.log(1 + cfg.minSample.strong))
}

export type Confirmation = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE'

/** Presentation bins on the 0–100 score (configurable; they label evidence strength, they do not add information). */
export function confirmationLabel(score: number | null, cfg: Pick<AnalyzerConfig, 'confirmationBins'>): Confirmation {
  if (score === null) return 'NONE'
  if (score >= cfg.confirmationBins.strong) return 'STRONG'
  if (score >= cfg.confirmationBins.moderate) return 'MODERATE'
  if (score >= cfg.confirmationBins.weak) return 'WEAK'
  return 'NONE'
}
