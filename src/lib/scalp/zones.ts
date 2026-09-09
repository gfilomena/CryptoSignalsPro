import type { Candle, Zone } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'

interface Pivot {
  index: number
  price: number
}

/** A candle is a pivot high/low when its high/low is the extreme within `window` candles on
 * each side — a simple, dependency-free local-extremum detector. */
function findPivots(candles: Candle[], window: number): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = []
  const lows: Pivot[] = []
  for (let i = window; i < candles.length - window; i++) {
    const slice = candles.slice(i - window, i + window + 1)
    const high = candles[i].high
    const low = candles[i].low
    if (high === Math.max(...slice.map((c) => c.high))) highs.push({ index: i, price: high })
    if (low === Math.min(...slice.map((c) => c.low))) lows.push({ index: i, price: low })
  }
  return { highs, lows }
}

/** Groups pivots whose prices are within `clusterPct`% of each other into clusters — a zone is a
 * price range, not a single tick, and a wide spread of pivots never becomes one zone. */
function clusterPivots(pivots: Pivot[], clusterPct: number): Pivot[][] {
  if (pivots.length === 0) return []
  const sorted = [...pivots].sort((a, b) => a.price - b.price)
  const clusters: Pivot[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]
    const cluster = clusters[clusters.length - 1]
    const clusterLow = cluster[0].price
    const tolerance = clusterLow * (clusterPct / 100)
    if (current.price - cluster[cluster.length - 1].price <= tolerance) {
      cluster.push(current)
    } else {
      clusters.push([current])
    }
  }
  return clusters
}

/**
 * Finds historically significant support/resistance zones on the structure timeframe: clusters
 * of swing pivots tested at least `zoneMinTouches` times within the last `zoneLookback` candles.
 * A single untested extreme never becomes a zone — this is deliberately conservative so the
 * engine only reacts to levels the market has actually respected more than once.
 */
export function detectZones(candles: Candle[], config: StrategyConfig): Zone[] {
  const recent = candles.slice(-config.zoneLookback)
  const { highs, lows } = findPivots(recent, config.zonePivotWindow)

  const toZones = (clusters: Pivot[][], kind: Zone['kind']): Zone[] =>
    clusters
      .filter((c) => c.length >= config.zoneMinTouches)
      .map((c) => ({
        kind,
        low: Math.min(...c.map((p) => p.price)),
        high: Math.max(...c.map((p) => p.price)),
        touches: c.length,
        lastTouchIndex: Math.max(...c.map((p) => p.index)),
      }))

  const resistances = toZones(clusterPivots(highs, config.zoneClusterPct), 'resistance')
  const supports = toZones(clusterPivots(lows, config.zoneClusterPct), 'support')

  return [...supports, ...resistances].sort((a, b) => b.lastTouchIndex - a.lastTouchIndex)
}

/** True when `price` sits inside the zone's range (with an optional small ATR-scaled tolerance —
 * price rarely tags the exact edge). */
export function priceInZone(zone: Zone, price: number, tolerance = 0): boolean {
  return price >= zone.low - tolerance && price <= zone.high + tolerance
}

/** True when `price` has closed decisively beyond the zone in `direction` (resistance broken
 * upward for a long, support broken downward for a short). */
export function priceBrokeZone(zone: Zone, price: number, direction: 'long' | 'short'): boolean {
  return direction === 'long' ? price > zone.high : price < zone.low
}

/** Nearest zone of `kind` whose range the current price is at or beyond (used to find the next
 * take-profit target: the closest opposing zone ahead of price). */
export function nearestZoneAhead(zones: Zone[], kind: Zone['kind'], price: number, direction: 'long' | 'short'): Zone | null {
  const candidates = zones.filter((z) => z.kind === kind && (direction === 'long' ? z.low > price : z.high < price))
  if (candidates.length === 0) return null
  return candidates.reduce((closest, z) => {
    const dist = direction === 'long' ? z.low - price : price - z.high
    const closestDist = direction === 'long' ? closest.low - price : price - closest.high
    return dist < closestDist ? z : closest
  })
}
