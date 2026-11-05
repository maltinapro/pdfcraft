import { tr } from './i18n'
import type { DocSpec } from './documents'
import type { Invoice, InvoiceItem, Settings } from './types'

export interface Issue {
  level: 'error' | 'warning'
  /** Short rule text that also fits below a form field ("Pflichtfeld"). */
  message: string
  /** Form field key in backend path style without `invoice.`/`document.` (`number`, `recipient.name`, `items[0].price`, `settings.bank.iban`). */
  field?: string
  /** The backend rejects the request (no PDF) until this is fixed. */
  blocking?: boolean
  /** Reported by the backend (shown right away, not only after the field was touched). */
  server?: boolean
}

const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/

function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (!IBAN_RE.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let rem = 0
  for (const ch of rearranged) {
    const digits = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const d of digits) rem = (rem * 10 + Number(d)) % 97
  }
  return rem === 1
}

/** Checks what an EN 16931 e-invoice needs (the backend otherwise attaches only `invoice-draft.xml`); never blocks the PDF. */
export function validateInvoice(settings: Settings, invoice: Invoice): Issue[] {
  const issues: Issue[] = []
  const err = (field: string, message: string) => issues.push({ level: 'error', field, message })
  const warn = (field: string, message: string) => issues.push({ level: 'warning', field, message })
  const blank = (s: string) => s.trim() === ''

  if (!settings.zugferd) return issues

  const s = settings.sender
  const r = invoice.recipient
  if (blank(s.taxNr) && blank(s.vatId)) err('settings.sender.taxNr', tr('Steuernummer oder USt-IdNr. angeben (E-Rechnung)', 'Enter a tax number or VAT ID (e-invoice)'))
  if (!blank(s.taxNr) && blank(s.vatId)) warn('settings.sender.vatId', tr('Ohne USt-IdNr. meldet der Validator BR-CO-26', 'Without a VAT ID the validator reports BR-CO-26'))
  if (blank(s.email) && blank(s.vatId)) warn('settings.sender.email', tr('E-Mail oder USt-IdNr. fehlt (Peppol-Adresse)', 'E-mail or VAT ID missing (Peppol address)'))
  if (settings.paymentDays < 1) err('settings.paymentDays', tr('Mindestens 1 Tag', 'At least 1 day'))
  if (blank(settings.bank.iban)) err('settings.bank.iban', tr('IBAN fehlt (E-Rechnung)', 'IBAN missing (e-invoice)'))
  else if (!ibanValid(settings.bank.iban)) err('settings.bank.iban', tr('IBAN ist ungültig', 'IBAN is invalid'))

  if (invoice.items.some((i) => i.taxRate === 0) && blank(settings.exemptionReason)) {
    err('settings.exemptionReason', tr('Grund fehlt (nötig bei Positionen mit 0 %)', 'Reason missing (needed for items with 0 %)'))
  }

  if (settings.einvoiceProfile === 'xrechnung') {
    if (blank(s.contactName)) err('settings.sender.contactName', tr('Für XRechnung nötig (BR-DE-5)', 'Required for XRechnung (BR-DE-5)'))
    if ((s.phone.match(/\d/g) ?? []).length < 3) err('settings.sender.phone', tr('Für XRechnung nötig, mind. 3 Ziffern (BR-DE-6)', 'Required for XRechnung, at least 3 digits (BR-DE-6)'))
    if (blank(s.email)) err('settings.sender.email', tr('Für XRechnung nötig', 'Required for XRechnung'))
    if (blank(r.buyerReference)) err('recipient.buyerReference', tr('Für XRechnung nötig (BR-DE-15)', 'Required for XRechnung (BR-DE-15)'))
    if (blank(r.email)) err('recipient.email', tr('Für XRechnung nötig (elektronische Adresse)', 'Required for XRechnung (electronic address)'))
  } else if (blank(r.email) && blank(r.vatId)) {
    warn('recipient.email', tr('E-Mail oder USt-IdNr. fehlt (Peppol-Adresse)', 'E-mail or VAT ID missing (Peppol address)'))
  }

  invoice.items.forEach((item, i) => {
    if (item.quantity <= 0) warn(`items[${i}].quantity`, tr('Sollte größer als 0 sein', 'Should be greater than 0'))
  })
  return issues
}

/** Mirrors the "is required" rules of the backend (`invoice.rs`, `documents.rs`); the request would be rejected. */
export function requiredIssues(
  spec: Pick<DocSpec, 'kind' | 'letter' | 'items'>,
  settings: Settings,
  doc: { number: string; date: string; reference?: string; subject?: string; body?: string; recipient: { name: string; address: string; city: string }; items: InvoiceItem[] },
): Issue[] {
  const issues: Issue[] = []
  const missing = (field: string, message = tr('Pflichtfeld', 'Required')) =>
    issues.push({ level: 'error', field, message, blocking: true })
  const blank = (s: string | undefined) => (s ?? '').trim() === ''

  if (!spec.letter && blank(doc.number)) missing('number')
  if (blank(doc.date)) missing('date', tr('Bitte ein Datum angeben', 'Please enter a date'))
  if (spec.kind === 'credit-note' && blank(doc.reference)) missing('reference')
  if (blank(doc.recipient.name)) missing('recipient.name')
  if (blank(doc.recipient.address)) missing('recipient.address')
  if (blank(doc.recipient.city)) missing('recipient.city')
  if (spec.letter) {
    if (blank(doc.subject)) missing('subject')
    if (blank(doc.body)) missing('body')
  }
  if (spec.items !== 'none') {
    if (doc.items.length === 0) missing('items', tr('Mindestens eine Position nötig', 'At least one item is needed'))
    doc.items.forEach((item, i) => {
      if (blank(item.description)) missing(`items[${i}].description`)
    })
  }
  if (blank(settings.sender.name)) missing('settings.sender.name')
  if (blank(settings.sender.address)) missing('settings.sender.address')
  if (blank(settings.sender.city)) missing('settings.sender.city')
  return issues
}
