import { useEffect, useState } from 'react'
import { tr } from '../lib/i18n'
import { applyTheme, storedTheme, type Theme } from '../lib/theme'
import { SegmentedButton } from './ui'

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? 'system')

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => theme === 'system' && applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  return (
    <SegmentedButton
      label={tr('Farbschema', 'Color theme')}
      value={theme}
      options={[
        { value: 'system', label: tr('System', 'System') },
        { value: 'light', label: tr('Hell', 'Light') },
        { value: 'dark', label: tr('Dunkel', 'Dark') },
      ]}
      onChange={(next) => {
        applyTheme(next, true)
        setTheme(next)
      }}
    />
  )
}
