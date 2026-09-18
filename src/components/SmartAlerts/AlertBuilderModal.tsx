import { useMemo, useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import type { AlertCategory, AlertMode, LogicalOperator, SessionDuration, SmartAlert } from '../../types/smartAlert'
import { COOLDOWN_OPTIONS_MIN } from '../../types/smartAlert'
import { AssetCombobox } from './AssetCombobox'
import { ConditionBuilder } from './ConditionBuilder'
import { formatConditionLine } from './formatCondition'
import { createAlertFromPreset, createCustomAlert, type PresetId } from '../../lib/smartAlerts/presets'
import { computeExpiresAt } from '../../lib/smartAlerts/conditionEngine'

const CATEGORIES: AlertCategory[] = [
  'PRICE', 'MOMENTUM', 'HIGH_LEVERAGE', 'FUNDING', 'OPEN_INTEREST', 'LIQUIDATION',
  'REVERSAL_WATCH', 'OVERHEATED_MARKET', 'MARKET_STRENGTH', 'CUSTOM',
]

const SESSION_DURATIONS: SessionDuration[] = ['30m', '1h', '2h', '4h', 'EOD']

interface Props {
  initial?: SmartAlert
  presetId?: PresetId
  presetName?: string
  onClose: () => void
  onSave: (alert: SmartAlert) => Promise<void>
}

export function AlertBuilderModal({ initial, presetId, presetName, onClose, onSave }: Props) {
  const { t } = useI18n()
  const isEditing = Boolean(initial)

  const [draft, setDraft] = useState<SmartAlert>(() => {
    if (initial) return initial
    if (presetId) return createAlertFromPreset(presetId, presetName ?? presetId, { symbol: 'BTC', mode: 'ALWAYS' })
    return createCustomAlert('', { symbol: 'BTC', mode: 'ALWAYS' })
  })
  const [step, setStep] = useState<'edit' | 'review'>('edit')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const setMode = (mode: AlertMode) => {
    setDraft((d) => ({ ...d, mode, sessionDuration: mode === 'SESSION' ? (d.sessionDuration ?? '1h') : undefined }))
  }
  const setSessionDuration = (sessionDuration: SessionDuration) => setDraft((d) => ({ ...d, sessionDuration }))

  const canSave = draft.name.trim().length > 0 && draft.conditions.length > 0

  const conditionLines = useMemo(() => draft.conditions.filter((c) => c.enabled).map((c) => formatConditionLine(t, c)), [draft.conditions, t])

  const handleActivate = async () => {
    setSaving(true)
    setSaveError(false)
    try {
      const now = Date.now()
      const finalAlert: SmartAlert = {
        ...draft,
        expiresAt: computeExpiresAt(draft.mode, draft.sessionDuration, now),
        sessionExpired: false,
      }
      await onSave(finalAlert)
      onClose()
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sa-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sa-modal">
        <div className="sa-modal-header">
          <h3>{step === 'review' ? t('smartAlerts.review.title') : isEditing ? t('smartAlerts.builder.editTitle') : t('smartAlerts.builder.newTitle')}</h3>
          <button type="button" className="sa-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {step === 'edit' ? (
          <>
            <div className="bt-field-row">
              <label className="bt-field bt-field-control">
                {t('smartAlerts.name.label')}
                <input
                  type="text"
                  value={draft.name}
                  placeholder={t('smartAlerts.name.placeholder')}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </label>
              <label className="bt-field bt-field-control">
                {t('smartAlerts.category.label')}
                <select value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as AlertCategory }))}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`smartAlerts.category.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="bt-field-row">
              <label className="bt-field bt-field-control">
                {t('smartAlerts.asset.label')}
                <AssetCombobox value={draft.symbol} onChange={(symbol) => setDraft((d) => ({ ...d, symbol }))} />
              </label>
            </div>

            <div className="bt-group">
              <div className="bt-group-title">{t('smartAlerts.mode.label')}</div>
              <div className="sa-segmented">
                <button type="button" className={draft.mode === 'ALWAYS' ? 'active' : ''} onClick={() => setMode('ALWAYS')}>
                  {t('smartAlerts.mode.always')}
                </button>
                <button type="button" className={draft.mode === 'SESSION' ? 'active' : ''} onClick={() => setMode('SESSION')}>
                  {t('smartAlerts.mode.session')}
                </button>
              </div>
              <p className="bt-field-hint" style={{ marginTop: 8 }}>
                {draft.mode === 'ALWAYS' ? t('smartAlerts.mode.alwaysHint') : t('smartAlerts.mode.sessionHint')}
              </p>
              {draft.mode === 'SESSION' ? (
                <>
                  <div className="bt-group-title" style={{ marginTop: 12 }}>
                    {t('smartAlerts.mode.duration')}
                  </div>
                  <div className="sa-segmented">
                    {SESSION_DURATIONS.map((d) => (
                      <button key={d} type="button" className={draft.sessionDuration === d ? 'active' : ''} onClick={() => setSessionDuration(d)}>
                        {t(`smartAlerts.mode.duration${d === 'EOD' ? 'Eod' : d}`)}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            <div className="bt-group">
              <div className="bt-group-title">{t('smartAlerts.condition.triggerAlert')}</div>
              <ConditionBuilder
                conditions={draft.conditions}
                operator={draft.operator}
                onConditionsChange={(conditions) => setDraft((d) => ({ ...d, conditions }))}
                onOperatorChange={(operator: LogicalOperator) => setDraft((d) => ({ ...d, operator }))}
              />
            </div>

            <div className="bt-field-row">
              <label className="bt-field bt-field-control">
                {t('smartAlerts.cooldown.label')}
                <select value={draft.cooldownMs / 60_000} onChange={(e) => setDraft((d) => ({ ...d, cooldownMs: +e.target.value * 60_000 }))}>
                  {COOLDOWN_OPTIONS_MIN.map((min) => (
                    <option key={min} value={min}>
                      {t(`smartAlerts.cooldown.min${min}`)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="bt-field-hint">{t('smartAlerts.cooldown.hint')}</p>
            </div>

            <div className="bt-field-row">
              <label className="bt-asset-chip" style={{ padding: '6px 10px' }}>
                <input type="checkbox" checked={draft.pushEnabled} onChange={(e) => setDraft((d) => ({ ...d, pushEnabled: e.target.checked }))} />{' '}
                {t('smartAlerts.push.label')}
              </label>
            </div>

            {!canSave ? <p className="bt-field-hint">{t('smartAlerts.builder.addAlertHint')}</p> : null}

            <div className="sa-modal-actions">
              <button type="button" className="sa-cancel" onClick={onClose}>
                {t('smartAlerts.review.cancel')}
              </button>
              <button type="button" className="sa-primary" disabled={!canSave} onClick={() => setStep('review')}>
                {t('smartAlerts.builder.addAlert')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="sa-review-block">
              <div className="sa-review-line">
                <strong>{draft.symbol}/USDT</strong>
                <span>{draft.name}</span>
              </div>
            </div>

            <div className="sa-review-block">
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('smartAlerts.review.triggerWhen')}</div>
              {conditionLines.map((line, i) => (
                <div key={i}>
                  {i > 0 ? <div className="sa-logical-divider">{t(`smartAlerts.logical.${draft.operator}`)}</div> : null}
                  <div className="sa-review-line">
                    <span>{line}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="sa-review-block">
              <div className="sa-review-line">
                <span>{t('smartAlerts.review.mode')}</span>
                <span>
                  {draft.mode === 'ALWAYS' ? t('smartAlerts.mode.always') : `${t('smartAlerts.mode.session')} — ${t(`smartAlerts.mode.duration${draft.sessionDuration === 'EOD' ? 'Eod' : draft.sessionDuration}`)}`}
                </span>
              </div>
              <div className="sa-review-line">
                <span>{t('smartAlerts.review.cooldown')}</span>
                <span>{t(`smartAlerts.cooldown.min${draft.cooldownMs / 60_000}`)}</span>
              </div>
              <div className="sa-review-line">
                <span>{t('smartAlerts.review.push')}</span>
                <span>{draft.pushEnabled ? t('smartAlerts.summary.on') : t('smartAlerts.summary.off')}</span>
              </div>
            </div>

            {saveError ? <p className="bt-field-hint" style={{ color: '#ef4444' }}>{t('smartAlerts.builder.saveError')}</p> : null}

            <div className="sa-modal-actions">
              <button type="button" className="sa-cancel" onClick={() => setStep('edit')}>
                {t('smartAlerts.review.cancel')}
              </button>
              <button type="button" className="sa-primary" disabled={saving} onClick={handleActivate}>
                {isEditing ? t('smartAlerts.review.save') : t('smartAlerts.review.activate')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
