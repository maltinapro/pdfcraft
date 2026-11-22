import { getLang, setLang, subscribeLang } from '@maltinapro/editor'

// The editor package keeps the language in memory; this app persists it and sets `<html lang>`.
const KEY = 'pdfcraft.lang'

try {
  const stored = localStorage.getItem(KEY)
  if (stored === 'de' || stored === 'en') setLang(stored)
} catch {
  // storage unavailable: keep the browser language
}

const apply = () => {
  document.documentElement.lang = getLang()
}
apply()

subscribeLang(() => {
  apply()
  try {
    localStorage.setItem(KEY, getLang())
  } catch {
    // ignore
  }
})
