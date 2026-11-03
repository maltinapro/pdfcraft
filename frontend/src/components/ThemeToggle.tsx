import { useEffect, useState } from 'react'
import { applyTheme, storedTheme, systemTheme, type Theme } from '../lib/theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (storedTheme()) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => !storedTheme() && setTheme(systemTheme())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next, true)
    setTheme(next)
  }

  return (
    <button
      className="btn"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren'}
      title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}
