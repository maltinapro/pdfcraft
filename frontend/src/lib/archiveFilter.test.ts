import { describe, expect, it } from 'vitest'
import { makeEntry, type ArchiveEntry } from './archive'
import { entryStatuses, filterEntries, isFiltered, NO_FILTER } from './archiveFilter'
import { DEFAULT_SETTINGS, defaultDoc, defaultInvoice, newItem } from '@maltinapro/editor'

const invoice = (number: string, date: string, recipient: string, price = 100): ArchiveEntry => {
  const source = defaultInvoice()
  source.number = number
  source.date = date
  source.recipient.name = recipient
  source.items = [newItem({ description: 'Arbeit', quantity: 1, price, taxRate: 0 })]
  return makeEntry('invoice', source, DEFAULT_SETTINGS)
}

const creditNote = (reference: string, price: number): ArchiveEntry => {
  const doc = defaultDoc('credit-note')
  doc.number = `S-${reference}`
  doc.reference = reference
  doc.items = [newItem({ description: 'Storno', quantity: 1, price, taxRate: 0 })]
  return makeEntry('credit-note', doc, DEFAULT_SETTINGS)
}

const offer = (number: string, date: string): ArchiveEntry => {
  const doc = defaultDoc('offer')
  doc.number = number
  doc.date = date
  return makeEntry('offer', doc, DEFAULT_SETTINGS)
}

const now = new Date(2026, 4, 15)

describe('archive filter', () => {
  const entries = [
    invoice('2026-003', '2026-05-02', 'Muster GmbH'),
    invoice('2026-002', '2026-02-10', 'Beispiel AG'),
    invoice('2025-044', '2025-12-30', 'Muster GmbH'),
    offer('A-2026-001', '2026-05-04'),
  ]

  it('keeps everything without a filter', () => {
    expect(isFiltered(NO_FILTER)).toBe(false)
    expect(filterEntries(entries, NO_FILTER, now)).toEqual(entries)
  })

  it('searches number and recipient, every word has to match', () => {
    expect(filterEntries(entries, { ...NO_FILTER, query: 'muster' }, now).map((e) => e.number)).toEqual(['2026-003', '2025-044'])
    expect(filterEntries(entries, { ...NO_FILTER, query: 'muster 2025' }, now).map((e) => e.number)).toEqual(['2025-044'])
    expect(filterEntries(entries, { ...NO_FILTER, query: 'nobody' }, now)).toEqual([])
  })

  it('filters by type and period', () => {
    expect(filterEntries(entries, { ...NO_FILTER, kind: 'offer' }, now).map((e) => e.number)).toEqual(['A-2026-001'])
    expect(filterEntries(entries, { ...NO_FILTER, period: 'month' }, now).map((e) => e.number)).toEqual(['2026-003', 'A-2026-001'])
    expect(filterEntries(entries, { ...NO_FILTER, period: 'year' }, now).map((e) => e.number)).toEqual(['2026-003', '2026-002', 'A-2026-001'])
  })

  it('distinguishes cancelled from partly credited invoices', () => {
    const all = [...entries, creditNote('2026-003', 100), creditNote('2026-002', 40)]
    const statuses = entryStatuses(all)
    expect(statuses.get(all[0].id)).toBe('cancelled')
    expect(statuses.get(all[1].id)).toBe('credited')
    expect(statuses.has(all[2].id)).toBe(false)
    expect(filterEntries(all, { ...NO_FILTER, cancelled: true }, now).map((e) => e.number)).toEqual(['2026-003', '2026-002'])
  })

  it('adds up several credit notes for one invoice', () => {
    const all = [invoice('2026-009', '2026-05-01', 'Muster GmbH'), creditNote('2026-009', 60), creditNote('2026-009', 40)]
    expect(entryStatuses(all).get(all[0].id)).toBe('cancelled')
  })
})
