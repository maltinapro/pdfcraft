import { DOC_SPECS } from './documents'
import { tr } from './i18n'

// Turns the technical error responses of the backend (`{ error, details }`) into plain
// sentences in the UI language. The API itself keeps its stable English texts.

interface Field {
  label: string
  area: string
}

const sender = () => tr('Absender & Design › Firma', 'Sender & design › Company')
const bank = () => tr('Absender & Design › Bankverbindung', 'Sender & design › Bank details')
const design = () => tr('Absender & Design › Design', 'Sender & design › Design')
const texts = () => tr('Absender & Design › Texte', 'Sender & design › Texts')
const recipient = () => tr('Empfänger', 'Recipient')
const itemArea = (n: number) => tr(`Positionen › Position ${n}`, `Items › Item ${n}`)

/** Labels and places exactly as the forms show them (see InvoiceForm, DocumentForm, SettingsForm). */
function settingsField(path: string): Field | null {
  const map: Record<string, () => Field> = {
    'settings.sender.name': () => ({ label: tr('Name', 'Name'), area: sender() }),
    'settings.sender.address': () => ({ label: tr('Straße / Hausnummer', 'Street / house number'), area: sender() }),
    'settings.sender.city': () => ({ label: tr('PLZ / Ort', 'Postcode / city'), area: sender() }),
    'settings.sender.email': () => ({ label: tr('E-Mail', 'E-mail'), area: sender() }),
    'settings.sender.contactName': () => ({ label: tr('Ansprechpartner', 'Contact person'), area: sender() }),
    'settings.sender.phone': () => ({ label: tr('Telefon', 'Phone'), area: sender() }),
    'settings.sender.taxNr': () => ({ label: tr('Steuernummer', 'Tax number'), area: sender() }),
    'settings.sender.vatId': () => ({ label: tr('USt-IdNr.', 'VAT ID'), area: sender() }),
    'settings.bank.name': () => ({ label: tr('Bank', 'Bank'), area: bank() }),
    'settings.bank.iban': () => ({ label: 'IBAN', area: bank() }),
    'settings.bank.bic': () => ({ label: 'BIC', area: bank() }),
    'settings.paymentDays': () => ({ label: tr('Zahlungsziel (Tage)', 'Payment term (days)'), area: bank() }),
    'settings.accentColor': () => ({ label: tr('Akzentfarbe', 'Accent color'), area: design() }),
    'settings.font': () => ({ label: tr('Schriftart', 'Font'), area: design() }),
    'settings.locale': () => ({ label: tr('Dokumentsprache', 'Document language'), area: design() }),
    'settings.einvoiceProfile': () => ({ label: tr('Profil', 'Profile'), area: tr('Absender & Design › E-Rechnung', 'Sender & design › E-invoice') }),
    'settings.intro': () => ({ label: tr('Einleitung', 'Introduction'), area: texts() }),
    'settings.closing': () => ({ label: tr('Schlusstext', 'Closing text'), area: texts() }),
    'settings.footer': () => ({ label: tr('Fußzeile', 'Footer'), area: texts() }),
  }
  return map[path]?.() ?? null
}

function documentField(rest: string, kind: string): Field | null {
  const spec = DOC_SPECS.find((d) => d.kind === kind)
  const here = spec?.label ?? tr('Beleg', 'Document')
  const numberLabel = kind === 'invoice' ? tr('Rechnungsnummer', 'Invoice number') : (spec?.numberLabel ?? tr('Nummer', 'Number'))
  const map: Record<string, () => Field> = {
    number: () => ({ label: numberLabel, area: here }),
    date: () => ({ label: spec?.dateLabel ?? tr('Datum', 'Date'), area: here }),
    reference: () => ({ label: (spec?.reference?.label ?? tr('Referenz', 'Reference')).replace(/ \((?:optional|Nr\.)?\)?$/, ''), area: here }),
    referenceDate: () => ({ label: spec?.referenceDate ?? tr('Datum', 'Date'), area: here }),
    validUntil: () => ({ label: spec?.validUntil ?? tr('Gültig bis', 'Valid until'), area: here }),
    deliveryDate: () => ({ label: spec?.deliveryDate ?? tr('Lieferdatum', 'Delivery date'), area: here }),
    subject: () => ({ label: tr('Betreff', 'Subject'), area: tr('Inhalt', 'Content') }),
    body: () => ({ label: tr('Text', 'Text'), area: tr('Inhalt', 'Content') }),
    reason: () => ({ label: tr('Begründung', 'Reason'), area: tr('Inhalt', 'Content') }),
    intro: () => ({ label: tr('Einleitung', 'Introduction'), area: tr('Texte', 'Texts') }),
    closing: () => ({ label: spec?.letter ? tr('Grußformel', 'Closing phrase') : tr('Schlusstext', 'Closing text'), area: tr('Texte', 'Texts') }),
    items: () => ({ label: tr('Positionen', 'Items'), area: tr('Positionen', 'Items') }),
    'recipient.name': () => ({ label: tr('Name', 'Name'), area: recipient() }),
    'recipient.address': () => ({ label: tr('Straße / Hausnummer', 'Street / house number'), area: recipient() }),
    'recipient.city': () => ({ label: tr('PLZ / Ort', 'Postcode / city'), area: recipient() }),
    'recipient.email': () => ({ label: tr('E-Mail', 'E-mail'), area: recipient() }),
    'recipient.vatId': () => ({ label: tr('USt-IdNr.', 'VAT ID'), area: recipient() }),
    'recipient.buyerReference': () => ({ label: tr('Leitweg-ID / Käuferreferenz', 'Leitweg ID / buyer reference'), area: recipient() }),
  }
  return map[rest]?.() ?? null
}

function itemField(name: string, n: number): Field | null {
  const labels: Record<string, () => string> = {
    description: () => tr('Beschreibung', 'Description'),
    quantity: () => tr('Menge', 'Quantity'),
    unit: () => tr('Einheit', 'Unit'),
    price: () => tr('Einzelpreis (netto)', 'Unit price (net)'),
    taxRate: () => tr('USt.', 'VAT'),
  }
  const label = labels[name]?.()
  return label ? { label, area: itemArea(n) } : null
}

/** `invoice.items[2].price` -> field "Einzelpreis (netto)" in "Positionen › Position 3". */
function resolveField(path: string, kind: string): { field: Field | null; prefix: string; raw: string } {
  let rest = path
  let prefix = ''
  const batch = /^(?:invoices|documents)\[(\d+)\]\.?/.exec(rest)
  if (batch) {
    prefix = tr(`Beleg ${Number(batch[1]) + 1}: `, `Document ${Number(batch[1]) + 1}: `)
    rest = rest.slice(batch[0].length)
  } else {
    rest = rest.replace(/^(?:invoice|document)\.?/, '')
  }
  const item = /^items\[(\d+)\]\.(.+)$/.exec(rest)
  const field = item ? itemField(item[2], Number(item[1]) + 1) : (settingsField(path) ?? documentField(rest, kind))
  return { field, prefix, raw: rest || path }
}

function rule(message: string): string | null {
  if (message === 'is required') return tr('muss ausgefüllt werden', 'must be filled in')
  let m = /^must be at most (\d+) characters$/.exec(message)
  if (m) return tr(`darf höchstens ${m[1]} Zeichen lang sein`, `must be at most ${m[1]} characters long`)
  if (message === 'must be a valid date as YYYY-MM-DD') return tr('braucht ein gültiges Datum', 'needs a valid date')
  if (message === 'must be a number between -1e9 and 1e9') return tr('muss eine Zahl sein (maximal 1 Milliarde)', 'must be a number (at most 1 billion)')
  if (message === 'must look like #1d4ed8') return tr('muss eine Farbe wie #1d4ed8 sein', 'must be a color like #1d4ed8')
  if (message === 'must be a whole number between 0 and 365') return tr('muss eine ganze Zahl zwischen 0 und 365 sein', 'must be a whole number between 0 and 365')
  if (message === 'must be one of: 19, 7, 0') return tr('muss 19 %, 7 % oder 0 % sein', 'must be 19 %, 7 % or 0 %')
  if (/^must be one of: /.test(message)) return tr('enthält einen nicht erlaubten Wert', 'contains a value that is not allowed')
  m = /^needs 1 to (\d+) items$/.exec(message)
  if (m) return tr(`braucht 1 bis ${m[1]} Positionen`, `needs 1 to ${m[1]} items`)
  return null
}

/** One line per problem: "Rechnung › Rechnungsnummer: muss ausgefüllt werden". */
function validationLines(details: string, kind: string): string[] {
  return details.split('; ').map((part) => {
    const more = /^\.\.\. and (\d+) more$/.exec(part)
    if (more) return tr(`… und ${more[1]} weitere Probleme`, `… and ${more[1]} more problems`)
    const idx = part.indexOf(': ')
    if (idx < 0) return part
    const { field, prefix, raw } = resolveField(part.slice(0, idx), kind)
    const text = rule(part.slice(idx + 2))
    if (!text) return part
    const where = field ? `${field.area} › ${field.label}` : raw
    return `${prefix}${where}: ${text}`
  })
}

/** Plain-language message for a backend error response (`code` = `error`, `details` as sent). */
export function friendlyApiError(status: number, code: string | undefined, details: string | undefined, kind = 'invoice'): string {
  switch (code) {
    case 'validation_error':
      return [tr('Bitte diese Eingaben prüfen:', 'Please check these entries:'), ...validationLines(details ?? '', kind)].join('\n')
    case 'rate_limited':
      return tr('Zu viele Anfragen. Bitte kurz warten und es erneut versuchen.', 'Too many requests. Please wait a moment and try again.')
    case 'unauthorized':
      return tr('Die Sitzung ist abgelaufen. Bitte die Seite neu laden.', 'Your session has expired. Please reload the page.')
    case 'store_unavailable':
      return tr('Der Dienst ist vorübergehend nicht erreichbar. Bitte später erneut versuchen.', 'The service is temporarily unavailable. Please try again later.')
    case 'invalid_asset':
      return tr('Das Logo konnte nicht verarbeitet werden. Bitte eine andere Bilddatei verwenden.', 'The logo could not be processed. Please use a different image file.')
    case 'invalid_request':
      return tr('Die Anfrage war unvollständig oder zu groß. Bitte Eingaben und Logo prüfen.', 'The request was incomplete or too large. Please check your input and logo.')
    case 'typst_compile_error':
    case 'template_parse_error':
    case 'template_render_error':
    case 'template_load_error':
    case 'task_join_error':
    case 'zip_error':
      return tr('Das PDF konnte nicht erstellt werden. Bitte Eingaben prüfen oder später erneut versuchen.', 'The PDF could not be created. Please check your input or try again later.')
    default:
      if (status === 413) return tr('Die Daten sind zu groß (z. B. das Logo).', 'The data is too large (e.g. the logo).')
      if (status >= 500) return tr('Der Server hat einen Fehler gemeldet. Bitte später erneut versuchen.', 'The server reported an error. Please try again later.')
      return tr(`Die Anfrage ist fehlgeschlagen (HTTP ${status}).`, `The request failed (HTTP ${status}).`)
  }
}
