import { createContext } from 'react'
import type { AppLocale } from './types'

export type TParams = Record<string, string | number> | undefined

export interface I18nContextValue {
  locale: AppLocale
  setLocale: (lng: AppLocale) => void
  t: (key: string, params?: TParams) => string
}

export const I18nContext = createContext<I18nContextValue | null>(null)
