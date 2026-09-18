import { useI18n } from '../../i18n/useI18n'
import { PRESET_DEFINITIONS, type PresetId } from '../../lib/smartAlerts/presets'

interface Props {
  onUsePreset: (presetId: PresetId) => void
}

export function PresetGrid({ onUsePreset }: Props) {
  const { t } = useI18n()

  return (
    <div>
      <p className="bt-field-hint" style={{ marginBottom: 12 }}>
        {t('smartAlerts.preset.editableHint')}
      </p>
      <div className="sa-preset-grid">
        {PRESET_DEFINITIONS.map((preset) => (
          <div className="sa-preset-card" key={preset.id}>
            <h4>{t(`smartAlerts.preset.${preset.id}.name`)}</h4>
            <p>{t(`smartAlerts.preset.${preset.id}.description`)}</p>
            <button type="button" className="bt-run-btn" onClick={() => onUsePreset(preset.id)}>
              {t('smartAlerts.preset.usePreset')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
