import { DOC_SPECS } from './documents'
import { tr } from './i18n'

// Turns the technical error responses of the backend (`{ error, details }`) into plain
// sentences in the UI language. The API itself keeps its stable English texts.

interface Field {
  label: string
  area: string
}

const sender = () => tr('Absender & Aussehen', 'Sender & look')
const bank = () => tr('Absender & Aussehen › Bankverbindung', 'Sender & look › Bank details')
const design = () => tr('Absender & Aussehen › Design', 'Sender & look › Design')
const texts = () => tr('Absender & Aussehen › Texte', 'Sender & look › Texts')
const details = () => tr('Details', 'Details')
const items = () => tr('Positionen', 'Items')
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
    'settings.paymentDays': () => ({ label: tr('Zahlungsziel (Tage)', 'Payment term (days)'), area: details() }),
    'settings.signature': () => ({ label: tr('Unterschrift', 'Signature'), area: tr('Absender & Design › Unterschrift', 'Sender & design › Signature') }),
    'settings.exemptionReason': () => ({ label: tr('Grund der Steuerbefreiung', 'Reason for tax exemption'), area: items() }),
    'settings.accentColor': () => ({ label: tr('Akzentfarbe', 'Accent color'), area: design() }),
    'settings.font': () => ({ label: tr('Schriftart', 'Font'), area: design() }),
    'settings.locale': () => ({ label: tr('Dokumentsprache', 'Document language'), area: design() }),
    'settings.einvoiceProfile': () => ({ label: tr('Profil', 'Profile'), area: tr('Absender & Aussehen › E-Rechnung', 'Sender & look › E-invoice') }),
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
    serviceDate: () => ({ label: tr('Leistungsdatum', 'Date of service'), area: details() }),
    serviceDateFrom: () => ({ label: tr('Leistungszeitraum von', 'Service period from'), area: details() }),
    serviceDateTo: () => ({ label: tr('Leistungszeitraum bis', 'Service period to'), area: details() }),
    dueDate: () => ({ label: tr('Fälligkeitsdatum', 'Due date'), area: details() }),
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
    postage: () => ({ label: tr('Briefmarke', 'Postage stamp'), area: tr('Porto', 'Postage') }),
    'recipient.name': () => ({ label: tr('Name', 'Name'), area: recipient() }),
    'recipient.address': () => ({ label: tr('Straße / Hausnummer', 'Street / house number'), area: recipient() }),
    'recipient.city': () => ({ label: tr('PLZ / Ort', 'Postcode / city'), area: recipient() }),
    'recipient.email': () => ({ label: tr('E-Mail', 'E-mail'), area: recipient() }),
    'recipient.vatId': () => ({ label: tr('USt-IdNr.', 'VAT ID'), area: recipient() }),
    'recipient.buyerReference': () => ({ label: tr('Leitweg-ID / Käuferreferenz', 'Leitweg ID / buyer reference'), area: recipient() }),
  }
  return map[rest]?.() ?? null
}

function rowField(list: 'invoices' | 'fees', name: string, n: number): Field | null {
  const labels: Record<string, () => string> = {
    number: () => tr('Rechnungsnummer', 'Invoice number'),
    date: () => tr('Rechnungsdatum', 'Invoice date'),
    dueDate: () => tr('Fällig am', 'Due on'),
    openAmount: () => tr('Offener Betrag', 'Open amount'),
    description: () => tr('Beschreibung', 'Description'),
    amount: () => tr('Betrag', 'Amount'),
  }
  const label = labels[name]?.()
  const area = list === 'invoices' ? tr(`Offene Posten › Rechnung ${n}`, `Open items › Invoice ${n}`) : tr(`Offene Posten › Gebühr ${n}`, `Open items › Fee ${n}`)
  return label ? { label, area } : null
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

/** Where a form field key (`recipient.name`, `items[0].price`, `settings.bank.iban`) lives in the UI. */
export function describeField(key: string, kind: string): Field | null {
  if (key.startsWith('settings.')) return settingsField(key)
  const item = /^items\[(\d+)\]\.(.+)$/.exec(key)
  if (item) return itemField(item[2], Number(item[1]) + 1)
  const row = /^(invoices|fees)\[(\d+)\]\.(.+)$/.exec(key)
  return row ? rowField(row[1] as 'invoices' | 'fees', row[3], Number(row[2]) + 1) : documentField(key, kind)
}

/** "Empfänger › Name" for a field key, `null` when the key is unknown. */
export function fieldTitle(key: string, kind: string): string | null {
  const field = describeField(key, kind)
  return field ? `${field.area} › ${field.label}` : null
}

function rule(message: string): string | null {
  if (message === 'is required') return tr('Pflichtfeld', 'Required')
  let m = /^must be at most (\d+) characters$/.exec(message)
  if (m) return tr(`Höchstens ${m[1]} Zeichen`, `At most ${m[1]} characters`)
  if (message === 'must be a valid date as YYYY-MM-DD') return tr('Bitte ein gültiges Datum angeben', 'Please enter a valid date')
  if (message === 'serviceDateFrom and serviceDateTo must be provided together') return tr('Bitte Start und Ende des Leistungszeitraums angeben', 'Enter both the start and end of the service period')
  if (message === 'serviceDateFrom must not be after serviceDateTo') return tr('Der Leistungszeitraum endet vor seinem Beginn', 'The service period ends before it starts')
  if (message === 'serviceDate cannot be combined with a service period') return tr('Ein Leistungsdatum kann nicht mit einem Leistungszeitraum kombiniert werden', 'A service date cannot be combined with a service period')
  if (message === 'dueDate must not be before the invoice date') return tr('Das Fälligkeitsdatum darf nicht vor dem Rechnungsdatum liegen', 'The due date cannot be before the invoice date')
  if (message === 'must be a number between -1e9 and 1e9') return tr('Bitte eine Zahl angeben (max. 1 Milliarde)', 'Please enter a number (at most 1 billion)')
  if (message === 'must look like #1d4ed8') return tr('Bitte eine Farbe wie #1d4ed8 angeben', 'Please enter a color like #1d4ed8')
  if (message === 'must be a whole number between 0 and 365') return tr('Ganze Zahl zwischen 0 und 365', 'Whole number between 0 and 365')
  if (message === 'must be one of: 19, 7, 0') return tr('Nur 19 %, 7 % oder 0 % möglich', 'Only 19 %, 7 % or 0 % allowed')
  if (/^must be one of: /.test(message)) return tr('Nicht erlaubter Wert', 'Value not allowed')
  if (message === 'must be a number greater than 0 and at most 1e9') return tr('Betrag größer als 0 angeben (max. 1 Milliarde)', 'Enter an amount greater than 0 (at most 1 billion)')
  if (message === 'must be a number from 0 to 1e9') return tr('Betrag von 0 bis 1 Milliarde angeben', 'Enter an amount from 0 to 1 billion')
  if (message === 'must be consumer or business') return tr('Bitte Unternehmen oder Verbraucher wählen', 'Please choose business or consumer')
  if (message === 'to must not be before from') return tr('Das Ende liegt vor dem Beginn', 'The end is before the start')
  if (message === 'must be a number from -10 to 20') return tr('Bitte einen Satz zwischen -10 und 20 % angeben', 'Enter a rate between -10 and 20 %')
  if (/^must be a number greater than 0 and at most 100/.test(message)) return tr('Bitte einen Zinssatz größer als 0 angeben', 'Enter a rate greater than 0')
  if (/^the base rate is not known for /.test(message)) return tr('Für diesen Zeitraum ist kein Basiszinssatz hinterlegt – bitte unten einen Basiszinssatz eintragen', 'No base rate is stored for this period – enter a base rate below')
  m = /^needs 1 to (\d+) invoices$/.exec(message)
  if (m) return tr(`1 bis ${m[1]} Rechnungen nötig`, `1 to ${m[1]} invoices needed`)
  m = /^needs 1 to (\d+) items$/.exec(message)
  if (m) return tr(`1 bis ${m[1]} Positionen nötig`, `1 to ${m[1]} items needed`)
  return null
}

export interface ServerIssue {
  /** Form field key without `invoice.`/`document.` prefix; undefined for summary lines like "and 3 more". */
  field?: string
  message: string
}

/**
 * Splits the backend's `path: message; path: message` text into field issues.
 * Entries of bulk requests (`invoices[2]…`) get no field because the forms edit a single document.
 */
export function parseValidationDetails(details: string): ServerIssue[] {
  return details.split('; ').map((part) => {
    const more = /^\.\.\. and (\d+) more$/.exec(part)
    if (more) return { message: tr(`… und ${more[1]} weitere Probleme`, `… and ${more[1]} more problems`) }
    const idx = part.indexOf(': ')
    if (idx < 0) return { message: part }
    const path = part.slice(0, idx)
    const message = rule(part.slice(idx + 2)) ?? part.slice(idx + 2)
    if (/^(?:invoices|documents)\[/.test(path)) {
      const batch = /^(?:invoices|documents)\[(\d+)\]\.?(.*)$/.exec(path)
      const n = Number(batch?.[1] ?? 0) + 1
      return { message: `${tr(`Beleg ${n}`, `Document ${n}`)} › ${batch?.[2] ?? ''}: ${message}` }
    }
    return { field: path.replace(/^(?:invoice|document)\./, ''), message }
  })
}

/** One line per problem: "Rechnung › Rechnungsnummer: Pflichtfeld". */
function validationLines(details: string, kind: string): string[] {
  return parseValidationDetails(details).map(({ field, message }) => {
    const title = field ? fieldTitle(field, kind) : null
    return title ? `${title}: ${message}` : field ? `${field}: ${message}` : message
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
    case 'server_busy':
      return tr('Der Server ist gerade ausgelastet. Bitte in ein paar Sekunden erneut versuchen.', 'The server is busy right now. Please try again in a few seconds.')
    case 'store_unavailable':
      return tr('Der Dienst ist vorübergehend nicht erreichbar. Bitte später erneut versuchen.', 'The service is temporarily unavailable. Please try again later.')
    case 'invalid_asset':
      return tr('Das Logo konnte nicht verarbeitet werden. Bitte eine andere Bilddatei verwenden.', 'The logo could not be processed. Please use a different image file.')
    case 'invalid_request':
      return tr('Die Anfrage war unvollständig oder zu groß. Bitte Eingaben und Logo prüfen.', 'The request was incomplete or too large. Please check your input and logo.')
    case 'unknown_offer':
      return tr('Dieses Angebot gibt es nicht (mehr). Bitte die Seite neu laden.', 'This offer does not exist (any more). Please reload the page.')
    case 'unknown_token':
      return tr('Dieses Token ist unbekannt oder schon zu lange abgelaufen, um es zu verlängern.', 'This token is unknown or expired too long ago to be renewed.')
    case 'mollie_not_configured':
    case 'payment_upstream_error':
      return tr('Der Zahlungsdienst ist gerade nicht erreichbar. Es wurde nichts berechnet. Bitte später erneut versuchen.', 'The payment service is not reachable right now. You were not charged. Please try again later.')
    case 'no_subscription':
      return tr('Zu diesem Token läuft kein Abonnement.', 'This token has no running subscription.')
    case 'postage_disabled':
      return tr('Der Kauf von Briefmarken ist auf diesem Server nicht aktiviert.', 'Buying postage stamps is not enabled on this server.')
    case 'postage_login_failed':
      return tr('Die Portokasse hat die Anmeldung abgelehnt. Bitte E-Mail-Adresse und Passwort prüfen.', 'The Portokasse rejected the login. Please check your e-mail address and password.')
    case 'postage_price_changed':
      return tr('Der Preis hat sich geändert. Bitte die Produktliste neu laden und erneut versuchen. Es wurde nichts gekauft.', 'The price has changed. Please reload the product list and try again. Nothing was bought.')
    case 'postage_duplicate':
      return tr('Dieser Kauf wurde bereits verarbeitet. Bitte erneut auf „Kaufen“ klicken.', 'This purchase was already processed. Please click “Buy” again.')
    case 'postage_wallet_insufficient':
      return tr('Das Guthaben der Portokasse reicht nicht aus. Bitte die Portokasse aufladen.', 'The Portokasse balance is too low. Please top up your Portokasse.')
    case 'postage_unknown_product':
      return tr('Dieses Porto-Produkt ist nicht mehr verfügbar. Bitte ein anderes wählen.', 'This postage product is no longer available. Please choose another one.')
    case 'postage_upstream_error':
      return tr('Die Deutsche Post ist gerade nicht erreichbar oder lehnt die Anfrage ab. Es wurde nichts gekauft. Bitte später erneut versuchen.', 'Deutsche Post is not reachable right now or rejects the request. Nothing was bought. Please try again later.')
    case 'postage_download_failed': {
      const order = /order (\S+)/.exec(details ?? '')?.[1]
      return tr(
        `Die Marke wurde bezahlt, konnte aber nicht geladen werden. Mit „Bezahlte Marke erneut laden“ holen Sie sie ohne neue Kosten ab${order ? ` (Bestellung ${order} in der Portokasse)` : ''}.`,
        `The stamp was paid for but could not be downloaded. Use "Fetch paid stamp again" to get it at no extra cost${order ? ` (order ${order} in your Portokasse)` : ''}.`,
      )
    }
    case 'postage_order_not_found':
      return tr(
        'Diese Bestellung gibt es in der Portokasse dieses Logins nicht. Bitte Zugangsdaten prüfen.',
        'This order does not exist in the Portokasse of this login. Please check the login.',
      )
    case 'typst_compile_error':
    case 'template_parse_error':
    case 'template_render_error':
    case 'task_join_error':
    case 'zip_error':
      return tr('Das PDF konnte nicht erstellt werden. Bitte Eingaben prüfen oder später erneut versuchen.', 'The PDF could not be created. Please check your input or try again later.')
    default:
      if (status === 413) return tr('Die Daten sind zu groß (z. B. das Logo).', 'The data is too large (e.g. the logo).')
      if (status >= 500) return tr('Der Server hat einen Fehler gemeldet. Bitte später erneut versuchen.', 'The server reported an error. Please try again later.')
      return tr(`Die Anfrage ist fehlgeschlagen (HTTP ${status}).`, `The request failed (HTTP ${status}).`)
  }
}

export const unreachableMessage = (): string =>
  tr('Der Server ist nicht erreichbar. Bitte Internetverbindung prüfen.', 'The server cannot be reached. Please check your connection.')

/** Raw browser network errors ("Failed to fetch", "Load failed", …) are shown as one translated sentence; other messages pass through. */
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message)) {
    return unreachableMessage()
  }
  return message
}
