import type { Candle, SetupType, TradeDirection, Zone } from '../../types/scalpSignal'
import type { StrategyConfig } from '../../config/strategyConfig'
import { nearestZoneAhead, priceBrokeZone, priceInZone } from './zones'

export interface SetupCandidate {
  setupType: SetupType
  zone: Zone
  /** Entry-timeframe index where price first touched/broke the zone. */
  triggerIndex: number
  /** Most recent candle — the one confirmation.ts evaluates for rejection + reclaim. */
  reactionIndex: number
}

const supportKindFor = (direction: TradeDirection): Zone['kind'] => (direction === 'long' ? 'support' : 'resistance')
const brokenKindFor = (direction: TradeDirection): Zone['kind'] => (direction === 'long' ? 'resistance' : 'support')

/**
 * ZONE_REACTION (mean-reversion): price has touched a significant zone in the direction's favor
 * (support for a long, resistance for a short) within the recent window. Touching alone is never
 * enough — this only locates the candidate; confirmation.ts still requires the most recent candle
 * to show an actual rejection + reclaim before the setup is tradable.
 */
function findZoneReaction(candles: Candle[], zones: Zone[], direction: TradeDirection, config: StrategyConfig): SetupCandidate | null {
  const window = candles.slice(-(config.pullbackMaxBars + 1))
  if (window.length < 2) return null

  for (const zone of zones.filter((z) => z.kind === supportKindFor(direction))) {
    const touchOffset = window.findIndex((c) => priceInZone(zone, direction === 'long' ? c.low : c.high))
    if (touchOffset === -1) continue
    return {
      setupType: 'ZONE_REACTION',
      zone,
      triggerIndex: candles.length - window.length + touchOffset,
      reactionIndex: candles.length - 1,
    }
  }
  return null
}

/**
 * BREAKOUT_PULLBACK_RETEST (trend continuation): a significant opposing zone was broken, price
 * pulled back into it (the level flips role — broken resistance becomes support and vice versa),
 * and it has been retested. The final rejection + reclaim is still checked by confirmation.ts.
 */
function findBreakoutPullbackRetest(candles: Candle[], zones: Zone[], direction: TradeDirection, config: StrategyConfig): SetupCandidate | null {
  const window = candles.slice(-(config.pullbackMaxBars + 2))
  if (window.length < 3) return null

  for (const zone of zones.filter((z) => z.kind === brokenKindFor(direction))) {
    const breakoutOffset = window.findIndex((c) => priceBrokeZone(zone, c.close, direction))
    if (breakoutOffset === -1) continue
    const breakoutIndex = candles.length - window.length + breakoutOffset
    const after = candles.slice(breakoutIndex + 1)
    if (after.length === 0) continue
    const retested = after.some((c) => priceInZone(zone, direction === 'long' ? c.low : c.high))
    if (!retested) continue
    return { setupType: 'BREAKOUT_PULLBACK_RETEST', zone, triggerIndex: breakoutIndex, reactionIndex: candles.length - 1 }
  }
  return null
}

/**
 * Looks for either valid structural pattern on the entry timeframe. ZONE_REACTION takes priority
 * over BREAKOUT_PULLBACK_RETEST — reacting at an already-proven level is preferred over chasing a
 * fresh break. Returns null (NO TRADE) when neither pattern is currently forming.
 */
export function findSetupCandidate(
  candles: Candle[],
  zones: Zone[],
  direction: TradeDirection,
  config: StrategyConfig,
): SetupCandidate | null {
  return findZoneReaction(candles, zones, direction, config) ?? findBreakoutPullbackRetest(candles, zones, direction, config)
}

/** Next significant opposing zone beyond `entryPrice` — used by the risk engine to build a
 * structure-based take-profit instead of a fixed R multiple. */
export function nextTargetZone(zones: Zone[], entryPrice: number, direction: TradeDirection): Zone | null {
  return nearestZoneAhead(zones, direction === 'long' ? 'resistance' : 'support', entryPrice, direction)
}
