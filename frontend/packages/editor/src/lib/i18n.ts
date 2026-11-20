import { useSyncExternalStore } from 'react'

export type Lang = 'de' | 'en'

const GERMAN_TIME_ZONES = [
  'Europe/Berlin',
  'Europe/Busingen',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Vaduz',
  'Europe/Luxembourg',
]

/**
 * First guess for the UI language: German when the browser prefers German or the device runs in a
 * German-speaking time zone (many German systems ship an English browser), otherwise English
 * unless the browser asks for another language we do not have (then German, the default).
 */
export function detectLang(
  languages: readonly string[] = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]),
  timeZone: string | undefined = resolveTimeZone(),
): Lang {
  const preferred = languages.filter(Boolean).map((l) => l.toLowerCase())
  if (preferred.some((l) => l === 'de' || l.startsWith('de-'))) return 'de'
  if (timeZone && GERMAN_TIME_ZONES.includes(timeZone)) return 'de'
  return preferred.some((l) => l === 'en' || l.startsWith('en-')) ? 'en' : 'de'
}

function resolveTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/**
 * Language of the editor UI. The package keeps it in memory only; the host decides where it is
 * persisted (`setLang` on start, `subscribeLang` to save changes).
 */
let lang: Lang = detectLang()
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
