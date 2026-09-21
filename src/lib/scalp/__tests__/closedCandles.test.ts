import { describe, expect, it } from 'vitest'
import { closedCandles } from '../klines'
import { PUSH_ALERT_TYPES } from '../../../config/strategyConfig'
import { ALL_ALERT_TYPES } from '../../push/pushClient'
import { candlesFromCloses } from './testUtils'

describe('closedCandles', () => {
  const step = 900_000
  const cs = candlesFromCloses([1, 2, 3, 4], undefined, step)

  it('drops the still-forming (last) candle', () => {
    const now = cs[3].openTime + 60_000 // 1 minute into the 4th candle
    expect(closedCandles(cs, now)).toEqual(cs.slice(0, 3))
  })

  it('keeps a candle once its scheduled close has passed (closeTime < now)', () => {
    expect(closedCandles(cs, cs[3].closeTime + 1)).toEqual(cs)
    expect(closedCandles(cs, cs[3].closeTime)).toEqual(cs.slice(0, 3)) // closeTime is inclusive of the last ms
  })

  it('does not change what the engine sees when only the forming candle moves (no repainting)', () => {
    const now = cs[3].openTime + 1
    const a = closedCandles([...cs.slice(0, 3), { ...cs[3], close: 999, high: 999 }], now)
    const b = closedCandles([...cs.slice(0, 3), { ...cs[3], close: 1, low: 0.5 }], now)
    expect(a).toEqual(b)
  })
})

describe('push alert types', () => {
  it('never pushes SETUP_DETECTED nor SETUP_INVALIDATED (the latter can only follow the former)', () => {
    expect(PUSH_ALERT_TYPES).not.toContain('SETUP_DETECTED')
    expect(PUSH_ALERT_TYPES).not.toContain('SETUP_INVALIDATED')
  })

  it('keeps the user-selectable list in sync with what the server may push', () => {
    expect([...ALL_ALERT_TYPES].sort()).toEqual([...PUSH_ALERT_TYPES].sort())
  })
})
