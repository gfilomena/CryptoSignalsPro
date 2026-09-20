import type { AlertCategory, AlertCondition, AlertMode, LogicalOperator, SessionDuration, SmartAlert } from '../../types/smartAlert'
import { computeExpiresAt } from './conditionEngine'

export type PresetId = 'reversal_watch' | 'overheated_market' | 'long_squeeze_watch' | 'short_squeeze_watch' | 'strong_momentum'

export interface PresetDefinition {
  id: PresetId
  /** i18n keys under smartAlerts.preset.<id>.{name,description} */
  category: AlertCategory
  operator: LogicalOperator
  defaultCooldownMs: number
  /** Consecutive matching cycles required before firing — presets default to 2 (rather than the
   * bare-minimum 1) so a single noisy tick on a fast-moving metric (price, RSI) doesn't fire the
   * alert on its own; see conditionEngine.processAlert. */
  defaultConfirmationCycles: number
  conditions: Array<Omit<AlertCondition, 'id' | 'enabled'>>
}

const min = (n: number) => n * 60_000

/** All thresholds here are defaults only — fully editable once the preset is loaded into the
 * alert builder (see spec: "Presets must remain editable after selection"). */
export const PRESET_DEFINITIONS: PresetDefinition[] = [
  {
    id: 'reversal_watch',
    category: 'REVERSAL_WATCH',
    operator: 'AND',
    defaultCooldownMs: min(15),
    defaultConfirmationCycles: 2,
    conditions: [
      { metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 },
      { metric: 'OPEN_INTEREST_CHANGE', timeframe: '15m', operator: '>=', threshold: 1 },
      // Price down + OI up alone is the textbook "new shorts / bearish continuation" quadrant, not
      // a reversal setup. Requiring funding already negative (shorts paying to hold) is what turns
      // it into a genuine crowded-short/reversal signal instead of just confirming the downtrend.
      { metric: 'FUNDING_RATE', operator: '<=', threshold: 0 },
    ],
  },
  {
    id: 'overheated_market',
    category: 'OVERHEATED_MARKET',
    operator: 'AND',
    defaultCooldownMs: min(30),
    defaultConfirmationCycles: 2,
    conditions: [
      { metric: 'RSI', timeframe: '1h', operator: '>=', threshold: 80 },
      { metric: 'OPEN_INTEREST_CHANGE', timeframe: '15m', operator: '>=', threshold: 1 },
      { metric: 'FUNDING_RATE', operator: '>=', threshold: 0.01 },
    ],
  },
  {
    id: 'long_squeeze_watch',
    category: 'LIQUIDATION',
    operator: 'AND',
    defaultCooldownMs: min(15),
    defaultConfirmationCycles: 2,
    conditions: [
      { metric: 'PRICE_CHANGE', operator: '<=', threshold: -0.5 },
      { metric: 'LONG_LIQUIDATIONS', operator: '>=', threshold: 5_000_000 },
      { metric: 'OPEN_INTEREST_CHANGE', timeframe: '15m', operator: '<=', threshold: -1 },
    ],
  },
  {
    id: 'short_squeeze_watch',
    category: 'LIQUIDATION',
    operator: 'AND',
    defaultCooldownMs: min(15),
    defaultConfirmationCycles: 2,
    conditions: [
      { metric: 'PRICE_CHANGE', operator: '>=', threshold: 0.5 },
      { metric: 'SHORT_LIQUIDATIONS', operator: '>=', threshold: 5_000_000 },
      { metric: 'OPEN_INTEREST_CHANGE', timeframe: '15m', operator: '<=', threshold: -1 },
    ],
  },
  {
    id: 'strong_momentum',
    category: 'MARKET_STRENGTH',
    operator: 'AND',
    defaultCooldownMs: min(30),
    defaultConfirmationCycles: 2,
    conditions: [
      { metric: 'PRICE_CHANGE', operator: '>=', threshold: 0.5 },
      { metric: 'VOLUME_CHANGE', timeframe: '15m', operator: '>=', threshold: 20 },
      { metric: 'OPEN_INTEREST_CHANGE', timeframe: '15m', operator: '>=', threshold: 1 },
    ],
  },
]

export function getPreset(id: PresetId): PresetDefinition {
  const preset = PRESET_DEFINITIONS.find((p) => p.id === id)
  if (!preset) throw new Error(`Unknown preset: ${id}`)
  return preset
}

function genId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export interface CreateAlertFromPresetOptions {
  symbol: string
  mode: AlertMode
  sessionDuration?: SessionDuration
  pushEnabled?: boolean
  now?: number
}

/** Instantiates a fresh, fully-editable SmartAlert from a preset — new ids, current timestamp. */
export function createAlertFromPreset(presetId: PresetId, name: string, opts: CreateAlertFromPresetOptions): SmartAlert {
  const preset = getPreset(presetId)
  const now = opts.now ?? Date.now()
  return {
    id: genId(),
    name,
    category: preset.category,
    symbol: opts.symbol,
    mode: opts.mode,
    sessionDuration: opts.mode === 'SESSION' ? opts.sessionDuration : undefined,
    enabled: true,
    operator: preset.operator,
    cooldownMs: preset.defaultCooldownMs,
    pushEnabled: opts.pushEnabled ?? true,
    createdAt: now,
    expiresAt: computeExpiresAt(opts.mode, opts.sessionDuration, now),
    conditions: preset.conditions.map((c) => ({ ...c, id: genId(), enabled: true })),
    confirmationCycles: preset.defaultConfirmationCycles,
    pendingMatchCount: 0,
  }
}

/** Builds a from-scratch custom alert with no preconfigured conditions (user adds their own). */
export function createCustomAlert(name: string, opts: CreateAlertFromPresetOptions): SmartAlert {
  const now = opts.now ?? Date.now()
  return {
    id: genId(),
    name,
    category: 'CUSTOM',
    symbol: opts.symbol,
    mode: opts.mode,
    sessionDuration: opts.mode === 'SESSION' ? opts.sessionDuration : undefined,
    enabled: true,
    operator: 'AND',
    cooldownMs: min(15),
    pushEnabled: opts.pushEnabled ?? true,
    createdAt: now,
    expiresAt: computeExpiresAt(opts.mode, opts.sessionDuration, now),
    conditions: [],
    confirmationCycles: 1,
    pendingMatchCount: 0,
  }
}

export function newCondition(overrides: Partial<Omit<AlertCondition, 'id'>> = {}): AlertCondition {
  return {
    id: genId(),
    metric: 'PRICE_CHANGE',
    operator: '<=',
    threshold: 0,
    enabled: true,
    ...overrides,
  }
}
