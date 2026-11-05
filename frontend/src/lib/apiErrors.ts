import { tr } from './i18n'

// Turns the technical error responses of the backend (`{ error, details }`) into plain
// sentences in the UI language. The API itself keeps its stable English texts.

const FIELDS: Record<string, () => string> = {
  'settings.accentColor': () => tr('Akzentfarbe', 'Accent colour'),
  'settings.paymentDays': () => tr('Zahlungsziel (Tage)', 'Payment term (days)'),
  'settings.font': () => tr('Schriftart', 'Font'),
  'settings.locale': () => tr('Dokumentsprache', 'Document language'),
  'settings.einvoiceProfile': () => tr('E-Rechnungsprofil', 'E-invoice profile'),
  'settings.footer': () => tr('Fußzeile', 'Footer'),
  'settings.intro': () => tr('Einleitungstext', 'Intro text'),
  'settings.closing': () => tr('Schlusstext', 'Closing text'),
  'settings.sender.name': () => tr('Absender: Name', 'Sender: name'),
  'settings.sender.address': () => tr('Absender: Straße / Hausnummer', 'Sender: street'),
  'settings.sender.city': () => tr('Absender: PLZ / Ort', 'Sender: postcode / city'),
  'settings.sender.email': () => tr('Absender: E-Mail', 'Sender: e-mail'),
  'settings.sender.phone': () => tr('Absender: Telefon', 'Sender: phone'),
  'settings.sender.taxNr': () => tr('Absender: Steuernummer', 'Sender: tax number'),
  'settings.sender.vatId': () => tr('Absender: USt-IdNr.', 'Sender: VAT ID'),
  'settings.sender.contactName': () => tr('Absender: Ansprechpartner', 'Sender: contact person'),
  'settings.bank.name': () => tr('Bank: Name', 'Bank: name'),
  'settings.bank.iban': () => tr('Bank: IBAN', 'Bank: IBAN'),
  'settings.bank.bic': () => tr('Bank: BIC', 'Bank: BIC'),
  number: () => tr('Nummer', 'Number'),
  date: () => tr('Datum', 'Date'),
  referenceDate: () => tr('Datum des Bezugsbelegs', 'Date of the referenced document'),
  validUntil: () => tr('Gültig bis', 'Valid until'),
  deliveryDate: () => tr('Lieferdatum', 'Delivery date'),
  reference: () => tr('Referenz', 'Reference'),
  reason: () => tr('Grund', 'Reason'),
  subject: () => tr('Betreff', 'Subject'),
  body: () => tr('Brieftext', 'Letter text'),
  intro: () => tr('Einleitung', 'Introduction'),
  closing: () => tr('Schlusstext', 'Closing text'),
  items: () => tr('Positionen', 'Items'),
  'recipient.name': () => tr('Empfänger: Name', 'Recipient: name'),
  'recipient.address': () => tr('Empfänger: Straße / Hausnummer', 'Recipient: street'),
  'recipient.city': () => tr('Empfänger: PLZ / Ort', 'Recipient: postcode / city'),
  'recipient.vatId': () => tr('Empfänger: USt-IdNr.', 'Recipient: VAT ID'),
  'recipient.email': () => tr('Empfänger: E-Mail', 'Recipient: e-mail'),
  'recipient.buyerReference': () => tr('Empfänger: Käuferreferenz / Leitweg-ID', 'Recipient: buyer reference'),
  description: () => tr('Beschreibung', 'Description'),
  quantity: () => tr('Menge', 'Quantity'),
  unit: () => tr('Einheit', 'Unit'),
  price: () => tr('Einzelpreis', 'Unit price'),
  taxRate: () => tr('Steuersatz', 'Tax rate'),
}

/** `invoice.items[2].price` -> "Position 3: Einzelpreis"; `invoices[1].number` -> "Beleg 2: Nummer". */
function fieldLabel(path: string): string {
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
  if (item) {
    const name = FIELDS[item[2]]?.() ?? item[2]
    return `${prefix}${tr(`Position ${Number(item[1]) + 1}`, `Item ${Number(item[1]) + 1}`)}: ${name}`
  }
  return prefix + (FIELDS[path]?.() ?? FIELDS[rest]?.() ?? (rest || path))
}

function rule(message: string): string | null {
  if (message === 'is required') return tr('muss ausgefüllt werden.', 'is required.')
  let m = /^must be at most (\d+) characters$/.exec(message)
  if (m) return tr(`darf höchstens ${m[1]} Zeichen lang sein.`, `must be at most ${m[1]} characters long.`)
  if (message === 'must be a valid date as YYYY-MM-DD') return tr('ist kein gültiges Datum.', 'is not a valid date.')
  if (message === 'must be a number between -1e9 and 1e9') return tr('muss eine Zahl sein (maximal 1 Milliarde).', 'must be a number (at most 1 billion).')
  if (message === 'must look like #1d4ed8') return tr('muss eine Farbe wie #1d4ed8 sein.', 'must be a colour like #1d4ed8.')
  if (message === 'must be a whole number between 0 and 365') return tr('muss eine ganze Zahl zwischen 0 und 365 sein.', 'must be a whole number between 0 and 365.')
  if (message === 'must be one of: 19, 7, 0') return tr('muss 19 %, 7 % oder 0 % sein.', 'must be 19 %, 7 % or 0 %.')
  m = /^must be one of: (.+)$/.exec(message)
  if (m) return tr('enthält einen nicht erlaubten Wert.', 'contains a value that is not allowed.')
  m = /^needs 1 to (\d+) items$/.exec(message)
  if (m) return tr(`braucht mindestens 1 und höchstens ${m[1]} Einträge.`, `needs between 1 and ${m[1]} entries.`)
  return null
}

function validationMessage(details: string): string {
  const parts = details.split('; ').map((part) => {
    const more = /^\.\.\. and (\d+) more$/.exec(part)
    if (more) return tr(`… und ${more[1]} weitere Probleme`, `… and ${more[1]} more problems`)
    const idx = part.indexOf(': ')
    if (idx < 0) return part
    const text = rule(part.slice(idx + 2))
    return text ? `${fieldLabel(part.slice(0, idx))} ${text}` : part
  })
  return parts.join(' · ')
}

/** Plain-language message for a backend error response (`code` = `error`, `details` as sent). */
export function friendlyApiError(status: number, code: string | undefined, details: string | undefined): string {
  switch (code) {
    case 'validation_error':
      return tr('Bitte Eingaben prüfen: ', 'Please check your input: ') + validationMessage(details ?? '')
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
