// Forward outcomes of an observation, computed strictly from bars AFTER the observation.
// Used both for historical analogs (offline bars) and for the realised outcomes of a live analysis (Binance klines).
export interface PathOutcome {
  /** forward return (fraction) from the entry price to the close H bars later */
  ret: number
  /** maximum favourable / adverse excursion of the price path within the horizon, long perspective (fractions; mae <= 0) */
  mfe: number
  mae: number
  /** maximum peak-to-trough decline of the closing path (fraction, <= 0) */
  maxDrawdown: number
  /** bars (1-based) until the MFE / MAE extreme was first reached */
  barsToMfe: number
  barsToMae: number
}

/**
 * Outcome of an observation whose entry price is `entry`, over the H bars that FOLLOW it: bars startIdx … startIdx+H−1 of
 * (highs, lows, closes). Returns null when the path is shorter than H bars (the outcome is not yet knowable).
 * The observation's own bar must NOT be part of the path: pass the index of the first bar after it.
 */
export function pathOutcome(entry: number, highs: ArrayLike<number>, lows: ArrayLike<number>, closes: ArrayLike<number>, startIdx: number, H: number): PathOutcome | null {
  if (startIdx + H > closes.length || H < 1 || !(entry > 0)) return null
  let hiMax = -Infinity
  let loMin = Infinity
  let barsToMfe = 1
  let barsToMae = 1
  let peak = entry
  let maxDd = 0
  for (let k = 0; k < H; k++) {
    const j = startIdx + k
    if (highs[j] > hiMax) { hiMax = highs[j]; barsToMfe = k + 1 }
    if (lows[j] < loMin) { loMin = lows[j]; barsToMae = k + 1 }
    if (closes[j] > peak) peak = closes[j]
    const dd = closes[j] / peak - 1
    if (dd < maxDd) maxDd = dd
  }
  return { ret: closes[startIdx + H - 1] / entry - 1, mfe: hiMax / entry - 1, mae: loMin / entry - 1, maxDrawdown: maxDd, barsToMfe, barsToMae }
}
