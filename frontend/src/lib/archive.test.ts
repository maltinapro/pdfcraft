import { describe, expect, it } from 'vitest'
import { groupBySettings, makeEntry } from './archive'
import { DEFAULT_SETTINGS, defaultDoc, defaultInvoice } from '@maltinapro/pdfcraft-editor'

describe('archive designs', () => {
  it('stores the selected design in the issue-time snapshot', () => {
    const settings = { ...DEFAULT_SETTINGS, design: 'modern-minimal' as const }

    expect(makeEntry('invoice', defaultInvoice(), settings).settings?.design).toBe('modern-minimal')
  })

  it('keeps the contrast design when grouping archive entries', () => {
    const settings = { ...DEFAULT_SETTINGS, design: 'contrast' as const }
    const entry = makeEntry('invoice', defaultInvoice(), settings)

    expect(groupBySettings([entry], DEFAULT_SETTINGS)[0].settings.design).toBe('contrast')
  })

  it('loads legacy archive snapshots as classic', () => {
    const entry = makeEntry('offer', defaultDoc('offer'), DEFAULT_SETTINGS)
    const { design: _design, ...legacySettings } = entry.settings!
    void _design
    const legacy = {
      ...entry,
      settings: legacySettings as unknown as NonNullable<typeof entry.settings>,
    }

    expect(groupBySettings([legacy], { ...DEFAULT_SETTINGS, design: 'modern-minimal' })[0].settings.design).toBe('classic')
  })
})
