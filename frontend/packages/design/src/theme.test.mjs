import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, storedTheme, systemTheme } from './theme'

describe('theme preference', () => {
  let values
  let dark

  beforeEach(() => {
    values = new Map()
    dark = false
    globalThis.localStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }
    globalThis.window = { matchMedia: () => ({ matches: dark }) }
    globalThis.document = { documentElement: { dataset: {} } }
  })

  it('uses System by default and follows the current OS preference', () => {
    expect(storedTheme()).toBeNull()
    expect(systemTheme()).toBe('light')
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('light')
    dark = true
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('persists Light and Dark but removes the preference for System', () => {
    applyTheme('light', true)
    expect(storedTheme()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')

    applyTheme('dark', true)
    expect(storedTheme()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    applyTheme('system', true)
    expect(storedTheme()).toBeNull()
    expect(values.has('pdfcraft.theme')).toBe(false)
  })
})
