import { useSyncExternalStore } from 'react'

export type Lang = 'de' | 'en'

/**
 * Language of the editor UI. The package keeps it in memory only; the host decides where it is
 * persisted (`setLang` on start, `subscribeLang` to save changes).
 */
let lang: Lang =
  typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'de'
const listeners = new Set<() => void>()

export function getLang(): Lang {
  return lang
}

export function setLang(next: Lang) {
  if (next === lang) return
  lang = next
  listeners.forEach((l) => l())
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, () => lang, () => lang)
}

export const tr = (de: string, en: string): string => (lang === 'en' ? en : de)

/** Locale for date/number formatting of the UI. */
export const uiLocale = (): string => (lang === 'en' ? 'en-GB' : 'de-DE')
