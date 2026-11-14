import { describe, expect, it } from 'vitest'
import { defaultInvoice, DEFAULT_SETTINGS } from './types'
import { parseConfig } from './storage'

describe('parseConfig', () => {
  it('defaults legacy settings to the classic design', () => {
    const config = parseConfig({
      schemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS, design: undefined },
      invoice: defaultInvoice(),
    })

    expect(config.settings.design).toBe('classic')
  })

  it('preserves a selected design', () => {
    const config = parseConfig({
      schemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS, design: 'modern-minimal' },
      invoice: defaultInvoice(),
    })

    expect(config.settings.design).toBe('modern-minimal')
  })

  it('falls back to the classic design for an unsupported value', () => {
    const config = parseConfig({
      schemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS, design: 'unknown' },
      invoice: defaultInvoice(),
    })

    expect(config.settings.design).toBe('classic')
  })
})
