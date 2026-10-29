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

/** Checks what an EN 16931 e-invoice needs (invoice-pro reports these inside the PDF otherwise). */
export function validateInvoice(settings: Settings, invoice: Invoice): Issue[] {
  const issues: Issue[] = []
  const err = (message: string) => issues.push({ level: 'error', message })
  const warn = (message: string) => issues.push({ level: 'warning', message })
  const blank = (s: string) => s.trim() === ''

  if (!settings.zugferd) return issues

  const s = settings.sender
  if (blank(s.name) || blank(s.address) || blank(s.city)) err('Absender: Name, Straße und PLZ/Ort sind Pflicht.')
  if (blank(s.taxNr) && blank(s.vatId)) err('Absender: Steuernummer oder USt-IdNr. ist Pflicht.')
  if (blank(s.email) && blank(s.vatId)) warn('Absender: E-Mail oder USt-IdNr. fehlt (Peppol-Adresse).')
  if (settings.paymentDays < 1) err('Zahlungsziel muss mindestens 1 Tag betragen.')
  if (blank(settings.bank.iban)) err('Bankverbindung: IBAN fehlt.')
  else if (!ibanValid(settings.bank.iban)) err('Bankverbindung: IBAN ist ungültig.')

  if (invoice.items.some((i) => i.taxRate === 0) && blank(settings.exemptionReason)) {
    err('Steuerbefreiung: Grund fehlt (Einstellungen → Bankverbindung).')
  }

  const r = invoice.recipient
  if (blank(r.name) || blank(r.address) || blank(r.city)) err('Empfänger: Name, Straße und PLZ/Ort sind Pflicht.')
  if (blank(r.email) && blank(r.vatId)) warn('Empfänger: E-Mail oder USt-IdNr. fehlt (Peppol-Adresse).')
  if (blank(invoice.number)) err('Rechnungsnummer fehlt.')
  if (invoice.items.length === 0) err('Mindestens eine Position ist Pflicht.')
  invoice.items.forEach((item, i) => {
    if (blank(item.description)) err(`Position ${i + 1}: Beschreibung fehlt.`)
    if (item.quantity <= 0) warn(`Position ${i + 1}: Menge sollte größer 0 sein.`)
  })
  return issues
}
