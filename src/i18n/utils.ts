import type { AppLocale, MessageTree } from './types'

export function localeTag(locale: AppLocale): string {
  if (locale === 'it') return 'it-IT'
  if (locale === 'es') return 'es-ES'
  return 'en-US'
}

export function getMessage(tree: MessageTree, path: string): string | undefined {
  const parts = path.split('.')
  let cur: MessageTree | undefined = tree
  for (const p of parts) {
    if (cur === undefined || typeof cur === 'string') return undefined
    cur = cur[p]
  }
  return typeof cur === 'string' ? cur : undefined
}

export function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{{${key}}}`,
  )
}
