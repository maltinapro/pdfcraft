import { tr } from '../i18n'
import type { InvoiceView, LineView } from './parse'
import type { CheckResult } from './check'

/**
 * A native subset of the EN 16931 and XRechnung business rules and code lists that can be decided from the
 * normalized view alone. It is NOT the Schematron validation of the KoSIT validator or Mustang (see `NOT_CHECKED`);
 * every finding names the rule id of the official rule set. Mirrored by `backend/src/einvoice_parse/rules.rs`.
 */

/** ISO 3166-1 alpha-2 plus `1A` (Kosovo), the EN 16931 country code list (BR-CL-14). */
const COUNTRIES = new Set(
  ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW 1A').split(' '),
)

/** ISO 4217 alpha-3 currency codes in use (BR-CL-03). */
const CURRENCIES = new Set(
  ('AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VED VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG').split(' '),
)

/** UNTDID 1001 document types allowed by EN 16931 (BR-CL-01). */
const TYPE_CODES = new Set('71 79 80 82 84 102 218 219 326 331 332 351 380 381 382 383 384 385 386 387 388 389 390 393 394 395 396 420 456 457 458 527 575 623 633 751 780 817 870 875 876 877 935'.split(' '))
/** Document types allowed by the XRechnung (BR-DE-17). */
const XRECHNUNG_TYPE_CODES = new Set('326 380 381 384 389 875 876 877'.split(' '))
/** UNCL 5305 VAT categories (BR-CL-17/18). */
const TAX_CATEGORIES = new Set('AE E S Z G O K L M'.split(' '))
/** Categories for which the seller needs a VAT or tax number (BR-S/Z/E-02, BR-DE-16). */
const SELLER_TAX_ID = new Set(['S', 'Z', 'E', 'AE', 'K', 'G', 'L', 'M'])

/** UNTDID 4461 payment means (BR-CL-16): 1-68, 70, 74-78, 91-97, ZZ. */
const paymentMeansKnown = (code: string): boolean => {
  if (code === 'ZZ') return true
  if (!/^\d{1,2}$/.test(code)) return false
  const n = Number(code)
  return (n >= 1 && n <= 68) || n === 70 || (n >= 74 && n <= 78) || (n >= 91 && n <= 97)
}

const ibanChecksumOk = (raw: string): boolean => {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let rest = 0
  for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97
  return rest === 1
}

const isXRechnung = (view: InvoiceView): boolean => /xrechnung|xeinkauf\.de/i.test(view.profile ?? '')

/** Findings are kept in order and deduplicated; each starts with the rule id. */
class Findings {
  readonly list: string[] = []
  add(rule: string, de: string, en: string) {
    const text = `${rule}: ${tr(de, en)}`
    if (!this.list.includes(text)) this.list.push(text)
  }
}

const usedCategories = (view: InvoiceView): string[] => {
  const all = [...view.items.map((l) => l.taxCategory), ...view.adjustments.map((a) => a.taxCategory)]
  return [...new Set(all.filter((c): c is string => !!c))]
}

/** More than two decimal places (BR-DEC-*); read from the parsed number, so trailing zeros do not count. */
const tooManyDecimals = (value: number | null): boolean => {
  if (value === null) return false
  const scaled = Math.abs(value) * 100
  return Math.abs(scaled - Math.round(scaled)) > Math.max(1e-6, scaled * 1e-12)
}

const lineName = (line: LineView, index: number) => tr(`Position ${line.id ?? index + 1}`, `Line ${line.id ?? index + 1}`)

export function en16931Rules(view: InvoiceView): CheckResult {
  const f = new Findings()
  const t = view.totals

  if (view.items.length === 0) f.add('BR-16', 'Die Rechnung braucht mindestens eine Position (BG-25)', 'The invoice needs at least one line (BG-25)')
  view.items.forEach((line, i) => {
    const n = lineName(line, i)
    if (!line.id) f.add('BR-21', `${n}: Positionskennung (BT-126) fehlt`, `${n}: line identifier (BT-126) is missing`)
    if (line.quantity === null) f.add('BR-22', `${n}: Menge (BT-129) fehlt`, `${n}: quantity (BT-129) is missing`)
    if (!line.unit) f.add('BR-23', `${n}: Mengeneinheit (BT-130) fehlt`, `${n}: unit of measure (BT-130) is missing`)
    if (line.net === null) f.add('BR-24', `${n}: Nettobetrag (BT-131) fehlt`, `${n}: line net amount (BT-131) is missing`)
    if (!line.name) f.add('BR-25', `${n}: Bezeichnung (BT-153) fehlt`, `${n}: item name (BT-153) is missing`)
    if (line.price === null) f.add('BR-26', `${n}: Nettopreis (BT-146) fehlt`, `${n}: net price (BT-146) is missing`)
    if (line.price !== null && line.price < 0) f.add('BR-27', `${n}: Der Nettopreis (BT-146) ist negativ`, `${n}: the net price (BT-146) is negative`)
    if (!line.taxCategory) f.add('BR-CO-04', `${n}: Steuerkategorie (BT-151) fehlt`, `${n}: VAT category (BT-151) is missing`)
    if (tooManyDecimals(line.net)) f.add('BR-DEC-23', `${n}: Nettobetrag (BT-131) hat mehr als zwei Nachkommastellen`, `${n}: line net amount (BT-131) has more than two decimal places`)
  })

  view.adjustments.forEach((a, i) => {
    const [de, en, amountRule, categoryRule, decRule] = a.charge
      ? ['Zuschlag', 'Charge', 'BR-36', 'BR-37', 'BR-DEC-05']
      : ['Nachlass', 'Allowance', 'BR-31', 'BR-32', 'BR-DEC-01']
    if (a.amount === null) f.add(amountRule, `${de} ${i + 1}: Betrag fehlt`, `${en} ${i + 1}: amount is missing`)
    if (!a.taxCategory) f.add(categoryRule, `${de} ${i + 1}: USt-Kategorie fehlt`, `${en} ${i + 1}: VAT category is missing`)
    if (tooManyDecimals(a.amount)) f.add(decRule, `${de} ${i + 1}: Betrag hat mehr als zwei Nachkommastellen`, `${en} ${i + 1}: amount has more than two decimal places`)
  })

  view.taxes.forEach((x) => {
    const label = x.category ?? '?'
    if (x.basis === null) f.add('BR-45', `${label}: Steuerbemessungsgrundlage (BT-116) fehlt`, `${label}: VAT category taxable amount (BT-116) is missing`)
    if (x.amount === null) f.add('BR-46', `${label}: Steuerbetrag (BT-117) fehlt`, `${label}: VAT category tax amount (BT-117) is missing`)
    if (!x.category) f.add('BR-47', 'Eine Steueraufschlüsselung hat keinen Kategoriecode (BT-118)', 'A VAT breakdown has no category code (BT-118)')
    if (x.rate === null && x.category !== 'O') f.add('BR-48', `${label}: Steuersatz (BT-119) fehlt`, `${label}: VAT category rate (BT-119) is missing`)
    if (tooManyDecimals(x.basis)) f.add('BR-DEC-19', `${label}: Steuerbemessungsgrundlage (BT-116) hat mehr als zwei Nachkommastellen`, `${label}: VAT category taxable amount (BT-116) has more than two decimal places`)
    if (tooManyDecimals(x.amount)) f.add('BR-DEC-20', `${label}: Steuerbetrag (BT-117) hat mehr als zwei Nachkommastellen`, `${label}: VAT category tax amount (BT-117) has more than two decimal places`)
  })

  const mandatory: [number | null, string, string, string, string][] = [
    [t.lineTotal, 'BR-12', 'Summe der Positionsbeträge (BT-106)', 'Sum of invoice line net amounts (BT-106)', 'BR-DEC-09'],
    [t.taxBasis, 'BR-13', 'Gesamtsumme ohne USt (BT-109)', 'Invoice total amount without VAT (BT-109)', 'BR-DEC-12'],
    [t.grandTotal, 'BR-14', 'Gesamtsumme mit USt (BT-112)', 'Invoice total amount with VAT (BT-112)', 'BR-DEC-14'],
    [t.due, 'BR-15', 'Zahlbetrag (BT-115)', 'Amount due for payment (BT-115)', 'BR-DEC-18'],
  ]
  for (const [value, rule, de, en, decRule] of mandatory) {
    if (value === null) f.add(rule, `${de} fehlt`, `${en} is missing`)
    if (tooManyDecimals(value)) f.add(decRule, `${de} hat mehr als zwei Nachkommastellen`, `${en} has more than two decimal places`)
  }
  const optional: [number | null, string, string, string][] = [
    [t.allowanceTotal, 'BR-DEC-10', 'Summe der Nachlässe (BT-107)', 'Sum of allowances on document level (BT-107)'],
    [t.chargeTotal, 'BR-DEC-11', 'Summe der Zuschläge (BT-108)', 'Sum of charges on document level (BT-108)'],
    [t.taxTotal, 'BR-DEC-13', 'Gesamtsumme USt (BT-110)', 'Invoice total VAT amount (BT-110)'],
    [t.prepaid, 'BR-DEC-16', 'Gezahlter Betrag (BT-113)', 'Paid amount (BT-113)'],
    [t.rounding, 'BR-DEC-17', 'Rundungsbetrag (BT-114)', 'Rounding amount (BT-114)'],
  ]
  for (const [value, rule, de, en] of optional) {
    if (tooManyDecimals(value)) f.add(rule, `${de} hat mehr als zwei Nachkommastellen`, `${en} has more than two decimal places`)
  }

  const vatPrefix = (who: string, whoEn: string, id: string | undefined) => {
    if (!id) return
    const prefix = id.trim().slice(0, 2).toUpperCase()
    if (!(COUNTRIES.has(prefix) || prefix === 'EL' || prefix === 'XI')) {
      f.add('BR-CO-9', `USt-IdNr. ${who} „${id}“ beginnt nicht mit einem Ländercode (ISO 3166-1 alpha-2)`, `${whoEn} VAT ID "${id}" does not start with a country code (ISO 3166-1 alpha-2)`)
    }
  }
  vatPrefix('des Verkäufers', 'Seller', view.seller.vatId)
  vatPrefix('des Käufers', 'Buyer', view.buyer.vatId)

  if (view.taxes.length === 0) f.add('BR-CO-18', 'Die Rechnung braucht mindestens eine Steueraufschlüsselung (BG-23)', 'The invoice needs at least one VAT breakdown (BG-23)')
  if ((t.due ?? 0) > 0 && !view.dueDate && !view.paymentTerms) {
    f.add('BR-CO-25', 'Es ist ein Betrag offen, aber weder Fälligkeitsdatum (BT-9) noch Zahlungsbedingungen (BT-20) sind angegeben', 'An amount is due but neither due date (BT-9) nor payment terms (BT-20) are given')
  }
  for (const p of view.payments) {
    if ((p.code === '30' || p.code === '58') && !p.iban) {
      f.add('BR-61', 'Bei Überweisung (Zahlungsart 30/58) fehlt die Kontonummer bzw. IBAN (BT-84)', 'For a credit transfer (payment means 30/58) the account identifier / IBAN (BT-84) is missing')
    }
  }

  const sellerTaxId = !!(view.seller.vatId || view.seller.taxNumber)
  const buyerId = !!(view.buyer.vatId || view.buyer.registration)
  for (const category of usedCategories(view)) {
    if (['S', 'Z', 'E', 'L', 'M'].includes(category) && !sellerTaxId) {
      f.add(`BR-${category === 'S' ? 'S' : category === 'Z' ? 'Z' : category === 'E' ? 'E' : category === 'L' ? 'IG' : 'IP'}-02`, `Kategorie ${category}: USt-IdNr. oder Steuernummer des Verkäufers fehlt`, `Category ${category}: seller VAT ID or tax number is missing`)
    }
    if (category === 'G' && !view.seller.vatId) f.add('BR-G-02', 'Kategorie G: USt-IdNr. des Verkäufers fehlt', 'Category G: seller VAT ID is missing')
    if (category === 'AE') {
      if (!sellerTaxId) f.add('BR-AE-02', 'Kategorie AE: USt-IdNr. oder Steuernummer des Verkäufers fehlt', 'Category AE: seller VAT ID or tax number is missing')
      if (!buyerId) f.add('BR-AE-02', 'Kategorie AE: USt-IdNr. oder Registerkennung des Käufers fehlt', 'Category AE: buyer VAT ID or legal registration identifier is missing')
    }
    if (category === 'K') {
      if (!view.seller.vatId) f.add('BR-IC-02', 'Kategorie K: USt-IdNr. des Verkäufers fehlt', 'Category K: seller VAT ID is missing')
      if (!view.buyer.vatId) f.add('BR-IC-02', 'Kategorie K: USt-IdNr. des Käufers fehlt', 'Category K: buyer VAT ID is missing')
    }
    if (category === 'O' && (view.seller.vatId || view.buyer.vatId)) {
      f.add('BR-O-02', 'Kategorie O (nicht steuerbar): USt-IdNr. von Verkäufer und Käufer dürfen nicht angegeben sein', 'Category O (not subject to VAT): seller and buyer VAT IDs must not be given')
    }
  }

  return {
    id: 'en16931-rules',
    title: tr('Geschäftsregeln der EN 16931 (Auswahl: Pflichtfelder, Nachkommastellen BR-DEC, BR-27, BR-61, BR-CO-9/18/25, kategoriebezogene Regeln)', 'EN 16931 business rules (selection: mandatory fields, decimal places BR-DEC, BR-27, BR-61, BR-CO-9/18/25, category rules)'),
    status: f.list.length ? 'error' : 'ok',
    findings: f.list,
  }
}

export function xrechnungRules(view: InvoiceView): CheckResult | undefined {
  if (!isXRechnung(view)) return undefined
  const f = new Findings()
  const s = view.seller
  const b = view.buyer

  if (view.payments.length === 0) f.add('BR-DE-1', 'Zahlungsangaben (BG-16) fehlen', 'Payment instructions (BG-16) are missing')
  if (!s.city) f.add('BR-DE-3', 'Ort des Verkäufers (BT-37) fehlt', 'Seller city (BT-37) is missing')
  if (!s.postcode) f.add('BR-DE-4', 'Postleitzahl des Verkäufers (BT-38) fehlt', 'Seller post code (BT-38) is missing')
  if (!s.contactName) f.add('BR-DE-5', 'Ansprechpartner des Verkäufers (BT-41) fehlt', 'Seller contact name (BT-41) is missing')
  if (!s.phone) f.add('BR-DE-6', 'Telefonnummer des Verkäufers (BT-42) fehlt', 'Seller telephone number (BT-42) is missing')
  else if ((s.phone.match(/\d/g) ?? []).length < 3) f.add('BR-DE-27', 'Die Telefonnummer des Verkäufers (BT-42) braucht mindestens drei Ziffern', 'The seller telephone number (BT-42) needs at least three digits')
  if (!s.email) f.add('BR-DE-7', 'E-Mail des Verkäufers (BT-43) fehlt', 'Seller email (BT-43) is missing')
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s.]+$/.test(s.email.trim())) f.add('BR-DE-28', 'Die E-Mail des Verkäufers (BT-43) sieht nicht wie eine E-Mail-Adresse aus', 'The seller email (BT-43) does not look like an email address')
  if (!b.city) f.add('BR-DE-8', 'Ort des Käufers (BT-52) fehlt', 'Buyer city (BT-52) is missing')
  if (!b.postcode) f.add('BR-DE-9', 'Postleitzahl des Käufers (BT-53) fehlt', 'Buyer post code (BT-53) is missing')
  if (!view.buyerReference) f.add('BR-DE-15', 'Leitweg-ID bzw. Käuferreferenz (BT-10) fehlt', 'Buyer reference / Leitweg-ID (BT-10) is missing')
  if (view.typeCode && !XRECHNUNG_TYPE_CODES.has(view.typeCode)) {
    f.add('BR-DE-17', `Rechnungstyp „${view.typeCode}“ ist in der XRechnung nicht zulässig (326, 380, 381, 384, 389, 875, 876, 877)`, `Invoice type "${view.typeCode}" is not allowed in XRechnung (326, 380, 381, 384, 389, 875, 876, 877)`)
  }
  if (view.typeCode === '384' && view.precedingInvoices.length === 0) {
    f.add('BR-DE-26', 'Eine Korrekturrechnung (384) braucht die Nummer der korrigierten Rechnung (BG-3)', 'A corrective invoice (384) needs the number of the corrected invoice (BG-3)')
  }
  if (usedCategories(view).some((c) => SELLER_TAX_ID.has(c)) && !s.vatId && !s.taxNumber) {
    f.add('BR-DE-16', 'USt-IdNr. oder Steuernummer des Verkäufers fehlt', 'Seller VAT ID or tax number is missing')
  }
  view.taxes.forEach((x) => {
    if (x.rate === null) f.add('BR-DE-14', `${x.category ?? '?'}: Steuersatz (BT-119) fehlt`, `${x.category ?? '?'}: VAT rate (BT-119) is missing`)
  })
  for (const p of view.payments) {
    if (p.code === '58' && p.iban && !ibanChecksumOk(p.iban)) f.add('BR-DE-19', `IBAN ${p.iban} hat eine falsche Prüfsumme`, `IBAN ${p.iban} has a wrong checksum`)
  }

  return {
    id: 'xrechnung-rules',
    title: tr('Regeln der XRechnung (Auswahl: BR-DE-1 bis -9, -14 bis -17, -19, -26 bis -28)', 'XRechnung rules (selection: BR-DE-1 to -9, -14 to -17, -19, -26 to -28)'),
    status: f.list.length ? 'error' : 'ok',
    findings: f.list,
  }
}

export function codeListChecks(view: InvoiceView): CheckResult {
  const f = new Findings()
  if (view.currency && /^[A-Z]{3}$/.test(view.currency) && !CURRENCIES.has(view.currency)) {
    f.add('BR-CL-03', `Währung „${view.currency}“ steht nicht in ISO 4217`, `Currency "${view.currency}" is not in ISO 4217`)
  }
  if (view.typeCode && !TYPE_CODES.has(view.typeCode)) f.add('BR-CL-01', `Rechnungstyp „${view.typeCode}“ steht nicht in der Codeliste UNTDID 1001`, `Invoice type "${view.typeCode}" is not in the UNTDID 1001 code list`)
  const parties: [string, string, string | undefined][] = [
    ['Verkäufer', 'seller', view.seller.country],
    ['Käufer', 'buyer', view.buyer.country],
    ['Zahlungsempfänger', 'payee', view.payee?.country],
  ]
  for (const [de, en, country] of parties) {
    if (country && !COUNTRIES.has(country)) f.add('BR-CL-14', `Land des ${de}s „${country}“ steht nicht in ISO 3166-1`, `Country of the ${en} "${country}" is not in ISO 3166-1`)
  }
  for (const category of usedCategories(view)) {
    if (!TAX_CATEGORIES.has(category)) f.add('BR-CL-18', `Steuerkategorie „${category}“ steht nicht in UNCL 5305`, `Tax category "${category}" is not in UNCL 5305`)
  }
  for (const x of view.taxes) {
    if (x.category && !TAX_CATEGORIES.has(x.category)) f.add('BR-CL-17', `Steuerkategorie „${x.category}“ steht nicht in UNCL 5305`, `Tax category "${x.category}" is not in UNCL 5305`)
  }
  for (const p of view.payments) {
    if (p.code && !paymentMeansKnown(p.code)) f.add('BR-CL-16', `Zahlungsart „${p.code}“ steht nicht in UNTDID 4461`, `Payment means "${p.code}" is not in UNTDID 4461`)
  }
  view.items.forEach((line, i) => {
    if (line.unit && !/^[A-Z0-9]{2,3}$/.test(line.unit)) f.add('BR-CL-23', `${lineName(line, i)}: Einheit „${line.unit}“ ist kein Code nach UN/ECE Rec. 20/21`, `${lineName(line, i)}: unit "${line.unit}" is not a UN/ECE Rec. 20/21 code`)
  })
  return {
    id: 'code-lists',
    title: tr('Codelisten: Währung, Länder, Rechnungstyp, Steuerkategorie, Zahlungsart, Format der Einheit', 'Code lists: currency, countries, invoice type, tax category, payment means, unit format'),
    status: f.list.length ? 'error' : 'ok',
    findings: f.list,
  }
}

export function ruleChecks(view: InvoiceView): CheckResult[] {
  return [en16931Rules(view), xrechnungRules(view), codeListChecks(view)].filter((r): r is CheckResult => r !== undefined)
}
