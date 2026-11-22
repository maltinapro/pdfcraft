import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, defaultInvoice } from '@maltinapro/pdfcraft-editor'
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

  it('defaults the footer to free text and keeps the structured mode and legal details', () => {
    const legacy = parseConfig({ schemaVersion: 1, settings: { ...DEFAULT_SETTINGS, footerMode: undefined }, invoice: defaultInvoice() })
    expect(legacy.settings.footerMode).toBe('free')
    expect(legacy.settings.sender.registerCourt).toBe('')

    const structured = parseConfig({
      schemaVersion: 1,
      settings: {
        ...DEFAULT_SETTINGS,
        footerMode: 'structured',
        sender: { ...DEFAULT_SETTINGS.sender, registerCourt: 'Amtsgericht Berlin' },
      },
      invoice: defaultInvoice(),
    })
    expect(structured.settings.footerMode).toBe('structured')
    expect(structured.settings.sender.registerCourt).toBe('Amtsgericht Berlin')

    const unknown = parseConfig({ schemaVersion: 1, settings: { ...DEFAULT_SETTINGS, footerMode: 'other' }, invoice: defaultInvoice() })
    expect(unknown.settings.footerMode).toBe('free')
  })

  it('preserves a selected design', () => {
    const config = parseConfig({
      schemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS, design: 'modern-minimal' },
      invoice: defaultInvoice(),
    })

    expect(config.settings.design).toBe('modern-minimal')
  })

  it('accepts the contrast design', () => {
    const config = parseConfig({
      schemaVersion: 1,
      settings: { ...DEFAULT_SETTINGS, design: 'contrast' },
      invoice: defaultInvoice(),
    })

    expect(config.settings.design).toBe('contrast')
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
