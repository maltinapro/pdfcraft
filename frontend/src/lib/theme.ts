export type Theme = 'light' | 'dark'

const KEY = 'pdfcraft.theme'

export function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function storedTheme(): Theme | null {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : null
}

export function applyTheme(theme: Theme, persist = false) {
  document.documentElement.dataset.theme = theme
  if (persist) localStorage.setItem(KEY, theme)
}
