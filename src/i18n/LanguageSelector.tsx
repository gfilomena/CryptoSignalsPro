import type { AppLocale } from './types'
import { useI18n } from './useI18n'

const OPTIONS: { value: AppLocale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'it', label: 'IT' },
  { value: 'es', label: 'ES' },
]

export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n()

  return (
    <label className="lang-selector">
      <span className="lang-selector-label">{t('language.label')}</span>
      <select
        className="lang-selector-select"
        value={locale}
        onChange={(e) => setLocale(e.target.value as AppLocale)}
        aria-label={t('language.label')}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
