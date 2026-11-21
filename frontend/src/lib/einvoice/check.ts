import { tr, uiLocale } from '@pdfcraft/editor'
import type { InvoiceView, LineView } from './parse'
import { ruleChecks } from './rules'

/**
 * Limited plausibility check of a received e-invoice: mandatory fields, arithmetic and a selection of EN 16931 / XRechnung rules (see `rules.ts`).
 * It is NOT a validation against the EN 16931 / XRechnung rules (see `NOT_CHECKED`); the UI never calls a file "valid".
 */
export interface CheckResult {
  id: string
  title: string
  /** `ok`: checked and fine · `warning`/`error`: finding · `skipped`: could not be checked because data is missing */
  status: 'ok' | 'warning' | 'error' | 'skipped'
  /** Findings in plain language (why it failed or was skipped); empty when `ok`. */
  findings: string[]
}

/** Tolerance for products that are rounded in different ways by different software (1 cent). */
const ROUNDING_CENTS = 1

/** Cents of an amount, half away from zero, tolerant to binary floating point noise (1.005 -> 101). */
const cents = (n: number): number => Math.sign(n) * Math.round(Math.abs(Number((n * 100).toPrecision(12))))

const ibanOk = (raw: string): boolean => {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let rest = 0
  for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97
  return rest === 1
}

const realDate = (iso: string | undefined): boolean => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(iso + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

/** Tax categories (UNCL 5305) for which a reason for the missing VAT is mandatory. */
const NEEDS_REASON = new Set(['E', 'AE', 'K', 'G', 'O'])
/** Tax categories with a 0 % rate. */
const ZERO_RATE = new Set(['Z', 'E', 'AE', 'K', 'G', 'O'])

export const money = (n: number | null | undefined, currency?: string): string => {
  if (n === null || n === undefined) return '–'
  const value = new Intl.NumberFormat(uiLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  return currency ? `${value} ${currency}` : value
}

const lineLabel = (line: LineView, index: number) => tr(`Position ${line.id ?? index + 1}`, `Line ${line.id ?? index + 1}`)

export function runChecks(view: InvoiceView): CheckResult[] {
  const results: CheckResult[] = []
  const cur = view.currency
  const t = view.totals
  const add = (id: string, title: string, findings: string[], severity: 'error' | 'warning' = 'error') =>
    results.push({ id, title, status: findings.length ? severity : 'ok', findings })
  const skip = (id: string, title: string, reason: string) => results.push({ id, title, status: 'skipped', findings: [reason] })
  const noData = tr('Nicht prüfbar: Beträge fehlen in der Datei.', 'Not checked: amounts are missing in the file.')

  // 1. Mandatory header fields
  const header: string[] = []
  if (!view.number) header.push(tr('Rechnungsnummer (BT-1) fehlt', 'Invoice number (BT-1) is missing'))
  if (!view.issueDate) header.push(tr('Rechnungsdatum (BT-2) fehlt', 'Issue date (BT-2) is missing'))
  if (!view.typeCode) header.push(tr('Rechnungstyp (BT-3) fehlt', 'Invoice type code (BT-3) is missing'))
  if (!view.currency) header.push(tr('Währung (BT-5) fehlt', 'Currency (BT-5) is missing'))
  else if (!/^[A-Z]{3}$/.test(view.currency)) header.push(tr(`Währung „${view.currency}“ ist kein dreibuchstabiger Code`, `Currency "${view.currency}" is not a three-letter code`))
  if (!view.profile) header.push(tr('Spezifikationskennung (BT-24) fehlt', 'Specification identifier (BT-24) is missing'))
  add('header', tr('Pflichtangaben im Kopf (Nummer, Datum, Typ, Währung, Spezifikation)', 'Mandatory header fields (number, date, type, currency, specification)'), header)

  // 2. Parties
  const parties: string[] = []
  if (!view.seller.name) parties.push(tr('Name des Verkäufers (BT-27) fehlt', 'Seller name (BT-27) is missing'))
  if (!view.seller.city) parties.push(tr('Ort des Verkäufers (BT-37) fehlt', 'Seller city (BT-37) is missing'))
  if (!view.seller.country) parties.push(tr('Land des Verkäufers (BT-40) fehlt', 'Seller country (BT-40) is missing'))
  if (!view.seller.vatId && !view.seller.taxNumber && !view.seller.registration) {
    parties.push(tr('Keine Steuer- oder Registerkennung des Verkäufers (USt-IdNr., Steuernummer oder Handelsregister)', 'No seller tax or legal identifier (VAT ID, tax number or registration)'))
  }
  if (!view.buyer.name) parties.push(tr('Name des Käufers (BT-44) fehlt', 'Buyer name (BT-44) is missing'))
  if (!view.buyer.country) parties.push(tr('Land des Käufers (BT-55) fehlt', 'Buyer country (BT-55) is missing'))
  add('parties', tr('Pflichtangaben zu Verkäufer und Käufer', 'Mandatory seller and buyer details'), parties)

  // 3. Lines present and complete
  const lines: string[] = []
  if (view.items.length === 0) lines.push(tr('Die Rechnung enthält keine Position', 'The invoice has no line'))
  view.items.forEach((line, i) => {
    const missing = [
      !line.name && tr('Bezeichnung', 'name'),
      line.quantity === null && tr('Menge', 'quantity'),
      !line.unit && tr('Einheit', 'unit'),
      line.price === null && tr('Einzelpreis', 'unit price'),
      line.net === null && tr('Nettobetrag', 'net amount'),
      !line.taxCategory && tr('Steuerkategorie', 'tax category'),
    ].filter(Boolean)
    if (missing.length) lines.push(`${lineLabel(line, i)}: ${tr('fehlt', 'missing')} ${missing.join(', ')}`)
  })
  add('lines', tr('Positionen vorhanden und vollständig', 'Lines present and complete'), lines)

  // 4. Line amount = quantity x price
  const lineMath: string[] = []
  let lineMathChecked = 0
  view.items.forEach((line, i) => {
    if (line.quantity === null || line.price === null || line.net === null || line.hasAdjustments) return
    lineMathChecked++
    const expected = cents((line.quantity * line.price) / line.priceBasis)
    if (Math.abs(expected - cents(line.net)) > ROUNDING_CENTS) {
      lineMath.push(
        `${lineLabel(line, i)}: ${tr('Menge × Preis ergibt', 'quantity × price gives')} ${money(expected / 100, cur)}, ${tr('angegeben', 'stated')} ${money(line.net, cur)}`,
      )
    }
  })
  const lineMathTitle = tr('Positionsbetrag = Menge × Einzelpreis (je Position, 1 Cent Rundungstoleranz)', 'Line amount = quantity × unit price (per line, 1 cent rounding tolerance)')
  if (view.items.length > 0 && lineMathChecked === 0) skip('line-math', lineMathTitle, tr('Keine Position mit Menge, Preis und Betrag ohne Positionsrabatt.', 'No line with quantity, price and amount without a line allowance.'))
  else add('line-math', lineMathTitle, lineMath)

  // 5. Sum of lines
  const sumTitle = tr('Summe der Positionen = Summe Positionsbeträge', 'Sum of lines = line total')
  if (t.lineTotal === null || view.items.some((l) => l.net === null)) skip('line-sum', sumTitle, noData)
  else {
    const sum = view.items.reduce((acc, l) => acc + cents(l.net!), 0)
    add('line-sum', sumTitle, sum === cents(t.lineTotal) ? [] : [tr(`Positionen ergeben ${money(sum / 100, cur)}, angegeben ${money(t.lineTotal, cur)}`, `Lines add up to ${money(sum / 100, cur)}, stated ${money(t.lineTotal, cur)}`)])
  }

  // 6. Net total
  const netTitle = tr('Nettosumme = Positionen − Nachlässe + Zuschläge', 'Net total = lines − allowances + charges')
  if (t.lineTotal === null || t.taxBasis === null) skip('net-total', netTitle, noData)
  else {
    const allowances = view.adjustments.filter((a) => !a.charge)
    const charges = view.adjustments.filter((a) => a.charge)
    const sumOf = (list: typeof allowances) => list.reduce((acc, a) => acc + cents(a.amount ?? 0), 0)
    const allowance = t.allowanceTotal !== null ? cents(t.allowanceTotal) : sumOf(allowances)
    const charge = t.chargeTotal !== null ? cents(t.chargeTotal) : sumOf(charges)
    const findings: string[] = []
    const expected = cents(t.lineTotal) - allowance + charge
    if (expected !== cents(t.taxBasis)) {
      findings.push(tr(`Ergibt ${money(expected / 100, cur)}, angegeben ${money(t.taxBasis, cur)}`, `Gives ${money(expected / 100, cur)}, stated ${money(t.taxBasis, cur)}`))
    }
    if (view.adjustments.length > 0 && t.allowanceTotal !== null && sumOf(allowances) !== cents(t.allowanceTotal)) {
      findings.push(tr('Summe der Nachlässe weicht von der angegebenen Gesamtsumme ab', 'Sum of allowances differs from the stated total'))
    }
    if (view.adjustments.length > 0 && t.chargeTotal !== null && sumOf(charges) !== cents(t.chargeTotal)) {
      findings.push(tr('Summe der Zuschläge weicht von der angegebenen Gesamtsumme ab', 'Sum of charges differs from the stated total'))
    }
    add('net-total', netTitle, findings)
  }

  // 7. Tax basis per category and rate
  const basisTitle = tr('Steuerbasis je Kategorie und Satz = Positionen − Nachlässe + Zuschläge', 'Tax basis per category and rate = lines − allowances + charges')
  if (view.taxes.length === 0) skip('tax-basis', basisTitle, tr('Nicht prüfbar: keine Steueraufschlüsselung in der Datei.', 'Not checked: no tax breakdown in the file.'))
  else if (view.items.some((l) => l.net === null)) skip('tax-basis', basisTitle, noData)
  else {
    const key = (category: string | undefined, rate: number | null) => `${category ?? '?'}|${rate ?? '?'}`
    const expected = new Map<string, number>()
    const bump = (k: string, amount: number) => expected.set(k, (expected.get(k) ?? 0) + amount)
    view.items.forEach((l) => bump(key(l.taxCategory, l.taxRate), cents(l.net!)))
    view.adjustments.forEach((a) => bump(key(a.taxCategory, a.taxRate), (a.charge ? 1 : -1) * cents(a.amount ?? 0)))
    const findings: string[] = []
    const stated = new Map<string, number>()
    for (const tax of view.taxes) {
      const k = key(tax.category, tax.rate)
      stated.set(k, (stated.get(k) ?? 0) + (tax.basis === null ? NaN : cents(tax.basis)))
    }
    for (const [k, value] of stated) {
      const [category, rate] = k.split('|')
      const label = `${category} ${rate} %`
      const exp = expected.get(k) ?? 0
      if (Number.isNaN(value)) findings.push(tr(`${label}: Steuerbasis fehlt`, `${label}: tax basis is missing`))
      else if (exp !== value) findings.push(tr(`${label}: Positionen ergeben ${money(exp / 100, cur)}, angegeben ${money(value / 100, cur)}`, `${label}: lines give ${money(exp / 100, cur)}, stated ${money(value / 100, cur)}`))
    }
    for (const [k, exp] of expected) {
      if (!stated.has(k) && exp !== 0) {
        const [category, rate] = k.split('|')
        findings.push(tr(`${category} ${rate} %: Positionen vorhanden, aber keine Steueraufschlüsselung`, `${category} ${rate} %: lines exist but no tax breakdown`))
      }
    }
    add('tax-basis', basisTitle, findings)
  }

  // 8. Tax amount = basis x rate
  const taxTitle = tr('Steuerbetrag = Steuerbasis × Satz (je Aufschlüsselung, 1 Cent Rundungstoleranz)', 'Tax amount = tax basis × rate (per breakdown, 1 cent rounding tolerance)')
  const computable = view.taxes.filter((x) => x.basis !== null && x.rate !== null && x.amount !== null)
  if (computable.length === 0) skip('tax-amount', taxTitle, noData)
  else {
    const findings = computable
      .filter((x) => Math.abs(cents((x.basis! * x.rate!) / 100) - cents(x.amount!)) > ROUNDING_CENTS)
      .map((x) => tr(`${x.category ?? '?'} ${x.rate} %: ${money(x.basis, cur)} ergibt ${money(cents((x.basis! * x.rate!) / 100) / 100, cur)}, angegeben ${money(x.amount, cur)}`, `${x.category ?? '?'} ${x.rate} %: ${money(x.basis, cur)} gives ${money(cents((x.basis! * x.rate!) / 100) / 100, cur)}, stated ${money(x.amount, cur)}`))
    add('tax-amount', taxTitle, findings)
  }

  // 9. Total tax
  const taxSumTitle = tr('Gesamtsteuer = Summe der Steuerbeträge', 'Total tax = sum of the tax amounts')
  if (t.taxTotal === null || view.taxes.length === 0 || view.taxes.some((x) => x.amount === null)) skip('tax-total', taxSumTitle, noData)
  else {
    const sum = view.taxes.reduce((acc, x) => acc + cents(x.amount!), 0)
    add('tax-total', taxSumTitle, sum === cents(t.taxTotal) ? [] : [tr(`Steuerbeträge ergeben ${money(sum / 100, cur)}, angegeben ${money(t.taxTotal, cur)}`, `Tax amounts add up to ${money(sum / 100, cur)}, stated ${money(t.taxTotal, cur)}`)])
  }

  // 10. Gross total
  const grossTitle = tr('Bruttosumme = Nettosumme + Steuer', 'Gross total = net total + tax')
  if (t.taxBasis === null || t.grandTotal === null) skip('gross-total', grossTitle, noData)
  else {
    const expected = cents(t.taxBasis) + cents(t.taxTotal ?? 0)
    add('gross-total', grossTitle, expected === cents(t.grandTotal) ? [] : [tr(`Ergibt ${money(expected / 100, cur)}, angegeben ${money(t.grandTotal, cur)}`, `Gives ${money(expected / 100, cur)}, stated ${money(t.grandTotal, cur)}`)])
  }

  // 11. Amount due
  const dueTitle = tr('Zahlbetrag = Bruttosumme − Anzahlungen + Rundung', 'Amount due = gross total − prepayments + rounding')
  if (t.grandTotal === null || t.due === null) skip('amount-due', dueTitle, noData)
  else {
    const expected = cents(t.grandTotal) - cents(t.prepaid ?? 0) + cents(t.rounding ?? 0)
    add('amount-due', dueTitle, expected === cents(t.due) ? [] : [tr(`Ergibt ${money(expected / 100, cur)}, angegeben ${money(t.due, cur)}`, `Gives ${money(expected / 100, cur)}, stated ${money(t.due, cur)}`)])
  }

  // 12. Tax categories
  const category: string[] = []
  for (const x of view.taxes) {
    const label = `${x.category ?? '?'} ${x.rate ?? '?'} %`
    if (!x.category) category.push(tr('Eine Steueraufschlüsselung hat keine Kategorie', 'A tax breakdown has no category'))
    else if (x.category === 'S' && (x.rate ?? 0) <= 0) category.push(tr(`${label}: Regelsteuersatz (S) braucht einen Satz über 0`, `${label}: standard rate (S) needs a rate above 0`))
    else if (ZERO_RATE.has(x.category) && x.rate !== null && x.rate !== 0) category.push(tr(`${label}: Diese Kategorie verlangt 0 %`, `${label}: this category requires 0 %`))
    if (x.category && NEEDS_REASON.has(x.category) && !x.exemptionReason && !x.exemptionCode) {
      category.push(tr(`${label}: Grund für die fehlende Steuer fehlt`, `${label}: reason for the missing tax is absent`))
    }
  }
  add('tax-category', tr('Steuerkategorien passen zum Satz, Befreiungsgrund vorhanden', 'Tax categories match the rate, exemption reason present'), category)

  // 13. Payment details
  const payment: string[] = []
  const owes = (t.due ?? 0) > 0
  if (owes && view.payments.length === 0) payment.push(tr('Keine Zahlungsangaben (BG-16) trotz offenem Betrag', 'No payment details (BG-16) although an amount is due'))
  for (const p of view.payments) {
    if (p.iban && !ibanOk(p.iban)) payment.push(tr(`IBAN ${p.iban} hat eine falsche Prüfsumme`, `IBAN ${p.iban} has a wrong checksum`))
  }
  add('payment', tr('Zahlungsangaben vorhanden, IBAN-Prüfsumme', 'Payment details present, IBAN checksum'), payment, 'warning')

  // 14. Dates
  const dates: string[] = []
  const rawDates: [string, string | undefined][] = [
    [tr('Rechnungsdatum', 'Issue date'), view.issueDate],
    [tr('Fälligkeitsdatum', 'Due date'), view.dueDate],
    [tr('Lieferdatum', 'Delivery date'), view.deliveryDate],
  ]
  for (const [label, value] of rawDates) if (value && !realDate(value)) dates.push(tr(`${label} „${value}“ ist kein existierendes Datum`, `${label} "${value}" is not an existing date`))
  if (realDate(view.issueDate) && realDate(view.dueDate) && view.dueDate! < view.issueDate!) {
    dates.push(tr('Das Fälligkeitsdatum liegt vor dem Rechnungsdatum', 'The due date is before the issue date'))
  }
  add('dates', tr('Datumsangaben sind echte Kalendertage, Fälligkeit nicht vor Rechnungsdatum', 'Dates are real calendar days, due date not before issue date'), dates, 'warning')

  results.push(...ruleChecks(view))

  return results
}

/** What this check explicitly does NOT cover; shown on the page next to the link to the official validator. */
export const NOT_CHECKED = (): string[] => [
  tr('Gültigkeit gegen das XML-Schema (XSD)', 'Validity against the XML schema (XSD)'),
  tr('Die übrigen Geschäftsregeln der Norm EN 16931 (BR-…) und der XRechnung (BR-DE-…); geprüft wird nur die oben genannte Auswahl, nicht die Schematron-Regeln des KoSIT-Prüftools', 'The remaining business rules of EN 16931 (BR-…) and XRechnung (BR-DE-…); only the selection named above is checked, not the Schematron rules of the KoSIT validator'),
  tr('Codelisten für Einheiten (UN/ECE Rec. 20: nur das Format) und Codes außerhalb der genannten Listen', 'Code lists for units (UN/ECE Rec. 20: format only) and codes outside the listed ones'),
  tr('PDF/A-3-Konformität, XMP-Metadaten und ob das PDF zum XML passt', 'PDF/A-3 conformity, XMP metadata and whether the PDF matches the XML'),
  tr('Echtheit, Signaturen und ob USt-IdNr., Steuersätze oder Bankverbindung stimmen', 'Authenticity, signatures and whether VAT IDs, tax rates or bank details are correct'),
]
