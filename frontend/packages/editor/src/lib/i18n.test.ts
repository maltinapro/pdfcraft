import { describe, expect, it } from 'vitest'
import { detectLang } from './i18n'

describe('detectLang', () => {
  it('prefers German when any preferred language is German', () => {
    expect(detectLang(['en-US', 'de-DE'], 'America/New_York')).toBe('de')
    expect(detectLang(['de'], undefined)).toBe('de')
  })

  it('uses German on a German-speaking time zone even with an English browser', () => {
    expect(detectLang(['en-US'], 'Europe/Berlin')).toBe('de')
    expect(detectLang(['en'], 'Europe/Vienna')).toBe('de')
  })

  it('uses English for English browsers elsewhere', () => {
    expect(detectLang(['en-GB'], 'Europe/London')).toBe('en')
    expect(detectLang(['en-US', 'fr'], 'America/Chicago')).toBe('en')
  })

  it('falls back to German for other languages or no information', () => {
    expect(detectLang(['fr-FR'], 'Europe/Paris')).toBe('de')
    expect(detectLang([], undefined)).toBe('de')
  })
})
