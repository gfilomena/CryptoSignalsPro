import { useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import { LIVE_ASSETS } from '../../constants/liveAssets'

interface Props {
  value: string
  onChange: (symbol: string) => void
}

/** Searchable dropdown over the app's existing tracked pairs (src/constants/liveAssets.ts) —
 * reuses the same asset list the main dashboard already shows, no duplicated data. */
export function AssetCombobox({ value, onChange }: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = LIVE_ASSETS.filter((a) => `${a.symbol} ${a.name}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="sa-combobox">
      <input
        value={open ? query : `${value}/USDT`}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('smartAlerts.asset.search')}
      />
      {open ? (
        <div className="sa-combobox-list">
          {filtered.length === 0 ? (
            <div style={{ padding: '8px 12px', opacity: 0.5, fontSize: '0.8rem' }}>{t('smartAlerts.asset.noResults')}</div>
          ) : (
            filtered.map((a) => (
              <button
                key={a.symbol}
                type="button"
                className={a.symbol === value ? 'active' : ''}
                onMouseDown={() => {
                  onChange(a.symbol)
                  setOpen(false)
                }}
              >
                {a.symbol}/USDT — {a.name}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
