import { describe, expect, it } from 'vitest'
import { groupBySettings, makeEntry } from './archive'
import { defaultDoc } from './documents'
import { DEFAULT_SETTINGS, defaultInvoice } from './types'

describe('archive designs', () => {
  it('stores the selected design in the issue-time snapshot', () => {
    const settings = { ...DEFAULT_SETTINGS, design: 'modern-minimal' as const }

    expect(makeEntry('invoice', defaultInvoice(), settings).settings?.design).toBe('modern-minimal')
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
