export type Theme = 'system' | 'light' | 'dark'
type ResolvedTheme = Exclude<Theme, 'system'>

/** localStorage key of the stored preference (`light` or `dark`; none means System). */
export const THEME_STORAGE_KEY = 'pdfcraft.theme'
const KEY = THEME_STORAGE_KEY

export function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function storedTheme(): ResolvedTheme | null {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : null
}

export function applyTheme(theme: Theme, persist = false) {
  document.documentElement.dataset.theme = theme === 'system' ? systemTheme() : theme
  if (persist) {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  }
}
