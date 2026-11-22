import { tr, uiLocale } from '@maltinapro/editor'

export const formatDate = (iso: string | undefined): string => {
  if (!iso) return '–'
  const d = new Date(iso + 'T00:00:00')
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(uiLocale(), { dateStyle: 'medium' }) : iso
}

export const formatNumber = (n: number | null): string => (n === null ? '–' : new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 4 }).format(n))

export const formatPercent = (n: number | null): string => (n === null ? '–' : `${new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: 2 }).format(n)} %`)

export const groupIban = (iban: string): string => iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()

/** UNTDID 1001 document type codes used in e-invoices. */
export function typeLabel(code: string | undefined): string {
  switch (code) {
    case '380':
      return tr('Rechnung', 'Invoice')
    case '381':
      return tr('Gutschrift', 'Credit note')
    case '384':
      return tr('Korrigierte Rechnung', 'Corrected invoice')
    case '389':
      return tr('Gutschriftsrechnung (Selbstfakturierung)', 'Self-billed invoice')
    case '326':
      return tr('Teilrechnung', 'Partial invoice')
    case '875':
    case '876':
    case '877':
      return tr('Rechnung (Teilleistung)', 'Invoice (partial)')
    case '751':
      return tr('Rechnungsinformation', 'Invoice information')
    default:
      return code ? tr(`Dokumenttyp ${code}`, `Document type ${code}`) : tr('Dokument', 'Document')
  }
}

/** Common UN/ECE Recommendation 20 unit codes; unknown codes are shown as they are. */
export function unitLabel(code: string | undefined): string {
  if (!code) return ''
  const known: Record<string, [string, string]> = {
    C62: ['Stk.', 'pcs'],
    H87: ['Stk.', 'pcs'],
    EA: ['Stk.', 'each'],
    HUR: ['Std.', 'h'],
    DAY: ['Tag(e)', 'day(s)'],
    MON: ['Monat(e)', 'month(s)'],
    ANN: ['Jahr(e)', 'year(s)'],
    MIN: ['Min.', 'min'],
    KGM: ['kg', 'kg'],
    GRM: ['g', 'g'],
    TNE: ['t', 't'],
    MTR: ['m', 'm'],
    KTM: ['km', 'km'],
    MTK: ['m²', 'm²'],
    LTR: ['l', 'l'],
    LS: ['pauschal', 'flat rate'],
    XPP: ['Stk.', 'pcs'],
    SET: ['Set', 'set'],
    KWH: ['kWh', 'kWh'],
  }
  const hit = known[code.toUpperCase()]
  return hit ? tr(hit[0], hit[1]) : code
}

/** UNTDID 4461 payment means codes. */
export function meansLabel(code: string | undefined): string {
  switch (code) {
    case '10':
      return tr('Barzahlung', 'Cash')
    case '30':
      return tr('Überweisung', 'Credit transfer')
    case '42':
      return tr('Zahlung auf Bankkonto', 'Payment to bank account')
    case '48':
      return tr('Kartenzahlung', 'Bank card')
    case '49':
      return tr('Lastschrift', 'Direct debit')
    case '57':
      return tr('Dauerauftrag', 'Standing agreement')
    case '58':
      return tr('SEPA-Überweisung', 'SEPA credit transfer')
    case '59':
      return tr('SEPA-Lastschrift', 'SEPA direct debit')
    case '97':
      return tr('Verrechnung', 'Clearing between partners')
    default:
      return code ? tr(`Zahlungsart ${code}`, `Payment means ${code}`) : tr('Zahlung', 'Payment')
  }
}

/** UNCL 5305 VAT category codes. */
export function categoryLabel(code: string | undefined): string {
  switch (code) {
    case 'S':
      return tr('Regelsteuersatz', 'Standard rate')
    case 'Z':
      return tr('Nullsatz', 'Zero rated')
    case 'E':
      return tr('Steuerbefreit', 'Exempt')
    case 'AE':
      return tr('Reverse Charge', 'Reverse charge')
    case 'K':
      return tr('Innergemeinschaftliche Lieferung', 'Intra-community supply')
    case 'G':
      return tr('Ausfuhr', 'Export')
    case 'O':
      return tr('Nicht steuerbar', 'Outside of scope')
    case 'L':
      return tr('Kanarische Inseln (IGIC)', 'Canary Islands (IGIC)')
    case 'M':
      return tr('Ceuta/Melilla (IPSI)', 'Ceuta/Melilla (IPSI)')
    default:
      return code ?? '–'
  }
}

/** Indents XML that arrives on one line; XML that already has line breaks is returned unchanged. */
export function prettyXml(xml: string): string {
  if ((xml.match(/\n/g)?.length ?? 0) > 2) return xml
  const parts = xml.replace(/>\s*</g, '>\n<').split('\n')
  let depth = 0
  return parts
    .map((part) => {
      if (/^<\//.test(part)) depth = Math.max(0, depth - 1)
      const line = '  '.repeat(depth) + part
      if (/^<[^!?/][^>]*>$/.test(part) && !/\/>$/.test(part) && !/<\//.test(part)) depth++
      return line
    })
    .join('\n')
}
