import { describe, expect, it } from 'vitest'
import { detectRegime } from '../regime'
import { DEFAULT_STRATEGY_CONFIG } from '../../../config/strategyConfig'
import { candlesFromCloses } from './testUtils'

const config = { ...DEFAULT_STRATEGY_CONFIG, emaFast: 5, emaMedium: 10, emaSlow: 20 }

describe('detectRegime', () => {
  it('detects a bullish regime on a steady uptrend', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i)
    const result = detectRegime(candlesFromCloses(closes), config)
    expect(result.regime).toBe('bullish')
    expect(result.ema20Slope).toBeGreaterThan(0)
  })

  it('detects a bearish regime on a steady downtrend', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 300 - i)
    const result = detectRegime(candlesFromCloses(closes), config)
    expect(result.regime).toBe('bearish')
    expect(result.ema50Slope).toBeLessThan(0)
  })

  it('is neutral on a flat market (no aggressive signals sideways)', () => {
    const closes = Array.from({ length: 30 }, () => 100)
    const result = detectRegime(candlesFromCloses(closes), config)
    expect(result.regime).toBe('neutral')
  })

  it('is neutral when there is not enough data yet', () => {
    const closes = Array.from({ length: 10 }, (_, i) => 100 + i)
    const result = detectRegime(candlesFromCloses(closes), config)
    expect(result.regime).toBe('neutral')
  })
})
