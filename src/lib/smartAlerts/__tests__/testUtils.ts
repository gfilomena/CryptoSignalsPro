import type { MetricSnapshot, SmartAlert } from '../../../types/smartAlert'

export function emptySnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    symbol: 'BTC',
    timestamp: 0,
    price: null,
    priceChangePct: null,
    openInterest: null,
    openInterestChangePct: {},
    fundingRate: null,
    volume: null,
    volumeChangePct: {},
    rsi: {},
    longLiquidations: null,
    shortLiquidations: null,
    liquidationSpike: null,
    ...overrides,
  }
}

export function baseAlert(overrides: Partial<SmartAlert> = {}): SmartAlert {
  return {
    id: 'alert-1',
    name: 'Test Alert',
    category: 'CUSTOM',
    symbol: 'BTC',
    mode: 'ALWAYS',
    enabled: true,
    conditions: [],
    operator: 'AND',
    cooldownMs: 15 * 60_000,
    pushEnabled: true,
    createdAt: 0,
    ...overrides,
  }
}
