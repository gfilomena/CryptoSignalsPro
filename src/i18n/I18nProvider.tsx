import { type ReactNode, useCallback, useMemo, useState } from 'react'
import type { AppLocale, MessageTree } from './types'
import { I18nContext, type TParams } from './I18nContext'
import { getMessage, interpolate } from './utils'
import { es } from './messages/es'
import { en } from './messages/en'
import { it } from './messages/it'

const STORAGE_KEY = 'appLocale'

const catalogs: Record<AppLocale, MessageTree> = { en, it, es }

function readStoredLocale(): AppLocale {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s === 'it' || s === 'es' || s === 'en') return s
  } catch {
    /* ignore */
  }
  return 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => readStoredLocale())

  const setLocale = useCallback((lng: AppLocale) => {
    setLocaleState(lng)
    try {
      localStorage.setItem(STORAGE_KEY, lng)
    } catch {
      /* ignore */
    }
  }, [])

  const t = useCallback(
    (key: string, params?: TParams) => {
      const primary = getMessage(catalogs[locale], key)
      const fallback = getMessage(catalogs.en, key)
      const raw = primary ?? fallback ?? key
      return interpolate(raw, params)
    },
    [locale],
  )

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
