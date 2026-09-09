import { useI18n } from '../i18n/useI18n'

interface Props {
  visible: boolean
  onUpdate: () => void
  onDismiss: () => void
}

export function UpdatePrompt({ visible, onUpdate, onDismiss }: Props) {
  const { t } = useI18n()
  if (!visible) return null

  return (
    <div className="scalp-update-banner">
      <span>{t('scalp.update.available')}</span>
      <div className="scalp-update-actions">
        <button type="button" className="bt-run-btn" onClick={onUpdate}>
          {t('scalp.update.reload')}
        </button>
        <button type="button" className="bt-reset-btn" onClick={onDismiss}>
          {t('scalp.update.dismiss')}
        </button>
      </div>
    </div>
  )
}
