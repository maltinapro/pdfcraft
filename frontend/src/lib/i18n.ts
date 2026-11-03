import { useSyncExternalStore } from 'react'

export type Lang = 'de' | 'en'

const KEY = 'pdfcraft.lang'

function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'de' || v === 'en') return v
  } catch {
    // storage unavailable: fall through to browser language
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'de'
}

let lang: Lang = initial()
const listeners = new Set<() => void>()
if (typeof document !== 'undefined') document.documentElement.lang = lang

export function getLang(): Lang {
  return lang
}

export function setLang(next: Lang) {
  if (next === lang) return
  lang = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // ignore
  }
  document.documentElement.lang = next
  listeners.forEach((l) => l())
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => lang,
  )
}

export const tr = (de: string, en: string): string => (lang === 'en' ? en : de)

/** Locale for date/number formatting of the UI. */
export const uiLocale = (): string => (lang === 'en' ? 'en-GB' : 'de-DE')
