import { describe, expect, it } from 'vitest'
import { dunnableInvoices, followUpDraft, makeEntry, openInvoiceRow } from './archive'
import { defaultDoc, defaultDunning, dunningPayload, newDunningFee, newDunningInvoice, parseDunning } from './documents'
import { defaultInvoice, DEFAULT_SETTINGS, newItem } from './types'
import { requiredIssues } from './validate'

const issuedInvoice = () => {
  const invoice = { ...defaultInvoice(), number: 'R-1', date: '2026-06-01', dueDate: '', items: [newItem({ description: 'A', quantity: 2, price: 100, taxRate: 19 })] }
  return makeEntry('invoice', invoice, { ...DEFAULT_SETTINGS, paymentDays: 10 })
}

describe('dunning letter', () => {
  it('sends the calculation request without UI-only fields', () => {
    const data = defaultDunning()
    data.invoices = [newDunningInvoice({ number: 'R-1', date: '2026-06-01', dueDate: '2026-06-16', openAmount: 1000 })]
    data.fees = [newDunningFee({ description: 'Fee', amount: 5 })]
    data.interest = { mode: 'business', from: '', to: '2026-08-10', rate: 0, amount: 0, baseRate: '' }
    expect(dunningPayload(data)).toEqual({
      dunningLevel: 1,
      paymentDeadline: data.paymentDeadline,
      invoices: [{ number: 'R-1', date: '2026-06-01', dueDate: '2026-06-16', openAmount: 1000 }],
      fees: [{ description: 'Fee', amount: 5 }],
      interest: { debtor: 'business', to: '2026-08-10' },
    })
  })

  it('sends rate, period and amount only for self-calculated interest', () => {
    const data = defaultDunning()
    data.interest = { mode: 'manual', from: '2026-07-01', to: '2026-07-31', rate: 9.12, amount: 4.5, baseRate: '3' }
    expect(dunningPayload(data).interest).toEqual({ rate: 9.12, from: '2026-07-01', to: '2026-07-31', amount: 4.5 })
    data.interest.mode = 'none'
    expect(dunningPayload(data)).not.toHaveProperty('interest')
  })

  it('passes a base rate override only when it is a number', () => {
    const data = defaultDunning()
    data.interest.mode = 'consumer'
    data.interest.baseRate = '1,5x'
    expect(dunningPayload(data).interest).toEqual({ debtor: 'consumer' })
    data.interest.baseRate = '1.52'
    expect(dunningPayload(data).interest).toEqual({ debtor: 'consumer', baseRate: 1.52 })
  })

  it('restores stored drafts defensively', () => {
    expect(parseDunning(undefined).invoices).toHaveLength(defaultDunning().invoices.length)
    const parsed = parseDunning({ level: 3, invoices: [{ number: 'X', openAmount: 'oops' }, 'bad'], interest: { mode: 'weird' } })
    expect(parsed.level).toBe(3)
    expect(parsed.invoices).toHaveLength(1)
    expect(parsed.invoices[0].number).toBe('X')
    expect(parsed.invoices[0].openAmount).toBe(0)
    expect(parsed.interest.mode).toBe('none')
  })

  it('takes an issued invoice as open item with its due date and gross total', () => {
    const entry = issuedInvoice()
    const row = openInvoiceRow(entry)!
    expect(row).toMatchObject({ number: 'R-1', date: '2026-06-01', dueDate: '2026-06-11', openAmount: 238 })
    const draft = followUpDraft(entry, 'dunning', defaultDoc('dunning')) as ReturnType<typeof defaultDoc>
    expect(draft.dunning?.invoices).toHaveLength(1)
    expect(draft.recipient.name).toBe(entry.invoice!.recipient.name)
  })

  it('offers only issued invoices that no credit note cancelled', () => {
    const entry = issuedInvoice()
    const credit = makeEntry('credit-note', { ...defaultDoc('credit-note'), reference: 'R-1' }, DEFAULT_SETTINGS)
    expect(dunnableInvoices([entry])).toHaveLength(1)
    expect(dunnableInvoices([entry, credit])).toHaveLength(0)
  })

  it('requires an invoice, its amount and the deadline', () => {
    const doc = defaultDoc('dunning')
    const spec = { kind: 'dunning' as const, items: 'none' as const, dunning: true }
    expect(requiredIssues(spec, DEFAULT_SETTINGS, doc).filter((i) => i.field?.startsWith('invoices'))).toEqual([])
    doc.dunning!.invoices = []
    doc.dunning!.paymentDeadline = ''
    const fields = requiredIssues(spec, DEFAULT_SETTINGS, doc).map((i) => i.field)
    expect(fields).toContain('invoices')
    expect(fields).toContain('paymentDeadline')
  })
})
