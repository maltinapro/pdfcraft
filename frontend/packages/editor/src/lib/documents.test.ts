import { describe, expect, it } from 'vitest'
import { DOC_SPECS, ZONES, zoneForField, type DocKind } from './documents'

const sharedSettings = [
  'settings.logo',
  'settings.signature',
  'settings.sender.name',
  'settings.sender.address',
  'settings.sender.city',
  'settings.sender.taxNr',
  'settings.sender.vatId',
  'settings.sender.email',
  'settings.sender.phone',
  'settings.sender.contactName',
  'settings.design',
  'settings.accentColor',
  'settings.font',
  'settings.locale',
  'settings.footer',
]
const invoiceSettings = ['settings.bank.name', 'settings.bank.iban', 'settings.bank.bic', 'settings.intro', 'settings.closing', 'settings.zugferd', 'settings.einvoiceProfile', 'settings.paymentDays']
const recipient = ['recipient.name', 'recipient.address', 'recipient.city', 'postage']
const einvoiceRecipient = ['recipient.email', 'recipient.vatId', 'recipient.buyerReference']
const pricedItems = ['items', 'items[*].description', 'items[*].quantity', 'items[*].unit', 'items[*].price', 'items[*].taxRate']
const quantityItems = ['items', 'items[*].description', 'items[*].quantity', 'items[*].unit']

const fieldsByKind: Record<DocKind, string[]> = {
  invoice: [...sharedSettings, ...invoiceSettings, ...recipient, ...einvoiceRecipient, 'number', 'date', 'serviceDate', 'serviceDateFrom', 'serviceDateTo', 'dueDate', 'settings.exemptionReason', ...pricedItems],
  'credit-note': [...sharedSettings, ...recipient, ...einvoiceRecipient, 'number', 'date', 'reference', 'referenceDate', 'reason', ...pricedItems, 'intro', 'closing'],
  offer: [...sharedSettings, ...recipient, 'number', 'date', 'reference', 'validUntil', 'intro', ...pricedItems, 'closing'],
  order: [...sharedSettings, ...recipient, 'number', 'date', 'reference', 'deliveryDate', 'intro', ...pricedItems, 'closing'],
  'delivery-note': [...sharedSettings, ...recipient, 'number', 'date', 'reference', 'deliveryDate', 'intro', ...quantityItems, 'closing'],
  letter: [...sharedSettings, ...recipient, 'date', 'reference', 'subject', 'body', 'closing'],
}

describe('document zones', () => {
  it('assigns every editable field to exactly one zone for all six types', () => {
    for (const spec of DOC_SPECS) {
      const zones = ZONES[spec.kind]
      const fields = zones.flatMap((entry) => entry.fields)

      expect(zones.map((entry) => entry.id)).toEqual(['sender', 'recipient', 'details', 'items'])
      expect(new Set(fields).size).toBe(fields.length)
      expect([...fields].sort()).toEqual([...fieldsByKind[spec.kind]].sort())
    }
  })

  it('preserves the letter text and delivery-note quantity-only variants', () => {
    expect(ZONES.letter[3].label).toBe('Text')
    expect(ZONES.letter[3].fields).toEqual(['subject', 'body', 'closing'])
    expect(ZONES['delivery-note'][3].fields).toEqual(quantityItems.concat('closing'))
  })

  it('maps dynamic item issues to their zone and leaves unknown fields unmapped', () => {
    expect(zoneForField('invoice', 'items[12].price')).toBe('items')
    expect(zoneForField('delivery-note', 'items[0].quantity')).toBe('items')
    expect(zoneForField('delivery-note', 'items[0].price')).toBeUndefined()
    expect(zoneForField('invoice', 'recipient.name')).toBe('recipient')
    expect(zoneForField('invoice', 'unknown')).toBeUndefined()
  })
})
