import { tr } from './i18n'
import type { Invoice, Settings } from './types'

export interface Issue {
  level: 'error' | 'warning'
  message: string
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

/** Checks what an EN 16931 e-invoice needs (the backend otherwise attaches only `invoice-draft.xml`). */
export function validateInvoice(settings: Settings, invoice: Invoice): Issue[] {
  const issues: Issue[] = []
  const err = (message: string) => issues.push({ level: 'error', message })
  const warn = (message: string) => issues.push({ level: 'warning', message })
  const blank = (s: string) => s.trim() === ''

  if (!settings.zugferd) return issues

  const s = settings.sender
  if (blank(s.name) || blank(s.address) || blank(s.city)) err(tr('Absender: Name, Straße und PLZ/Ort sind Pflicht.', 'Sender: name, street and postcode/city are required.'))
  if (blank(s.taxNr) && blank(s.vatId)) err(tr('Absender: Steuernummer oder USt-IdNr. ist Pflicht.', 'Sender: tax number or VAT ID is required.'))
  if (blank(s.email) && blank(s.vatId)) warn(tr('Absender: E-Mail oder USt-IdNr. fehlt (Peppol-Adresse).', 'Sender: e-mail or VAT ID is missing (Peppol address).'))
  if (settings.paymentDays < 1) err(tr('Zahlungsziel muss mindestens 1 Tag betragen.', 'Payment term must be at least 1 day.'))
  if (blank(settings.bank.iban)) err(tr('Bankverbindung: IBAN fehlt.', 'Bank details: IBAN is missing.'))
  else if (!ibanValid(settings.bank.iban)) err(tr('Bankverbindung: IBAN ist ungültig.', 'Bank details: IBAN is invalid.'))

  if (invoice.items.some((i) => i.taxRate === 0) && blank(settings.exemptionReason)) {
    err(tr('Steuerbefreiung: Grund fehlt (Einstellungen → Bankverbindung).', 'Tax exemption: reason is missing (Sender & design → Bank details).'))
  }

  const xr = settings.einvoiceProfile === 'xrechnung'
  if (xr) {
    if (blank(s.contactName)) err(tr('XRechnung: Ansprechpartner des Absenders fehlt (BR-DE-5).', 'XRechnung: sender contact person is missing (BR-DE-5).'))
    if ((s.phone.match(/\d/g) ?? []).length < 3) err(tr('XRechnung: Telefon des Absenders mit mindestens 3 Ziffern fehlt (BR-DE-6).', 'XRechnung: sender phone with at least 3 digits is missing (BR-DE-6).'))
    if (blank(s.email)) err(tr('XRechnung: E-Mail des Absenders fehlt.', 'XRechnung: sender e-mail is missing.'))
    if (blank(invoice.recipient.buyerReference)) err(tr('XRechnung: Leitweg-ID / Käuferreferenz fehlt (BR-DE-15).', 'XRechnung: Leitweg ID / buyer reference is missing (BR-DE-15).'))
    if (blank(invoice.recipient.email)) err(tr('XRechnung: E-Mail des Empfängers fehlt (elektronische Adresse).', 'XRechnung: recipient e-mail is missing (electronic address).'))
  }

  const r = invoice.recipient
  if (blank(r.name) || blank(r.address) || blank(r.city)) err(tr('Empfänger: Name, Straße und PLZ/Ort sind Pflicht.', 'Recipient: name, street and postcode/city are required.'))
  if (blank(r.email) && blank(r.vatId)) warn(tr('Empfänger: E-Mail oder USt-IdNr. fehlt (Peppol-Adresse).', 'Recipient: e-mail or VAT ID is missing (Peppol address).'))
  if (blank(invoice.number)) err(tr('Rechnungsnummer fehlt.', 'Invoice number is missing.'))
  if (invoice.items.length === 0) err(tr('Mindestens eine Position ist Pflicht.', 'At least one item is required.'))
  invoice.items.forEach((item, i) => {
    if (blank(item.description)) err(tr(`Position ${i + 1}: Beschreibung fehlt.`, `Item ${i + 1}: description is missing.`))
    if (item.quantity <= 0) warn(tr(`Position ${i + 1}: Menge sollte größer 0 sein.`, `Item ${i + 1}: quantity should be greater than 0.`))
  })
  return issues
}
