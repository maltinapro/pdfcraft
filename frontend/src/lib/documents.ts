import { isObj, mergeObject, type Obj } from './storage'
import { newItem, todayIso, type InvoiceItem } from './types'

export type DocKind = 'invoice' | 'credit-note' | 'offer' | 'order' | 'delivery-note' | 'letter'

/** Data of every document type except the invoice (see `Invoice` in `types.ts`). */
export interface Doc {
  number: string
  /** ISO date, `YYYY-MM-DD`. */
  date: string
  recipient: { name: string; address: string; city: string }
  items: InvoiceItem[]
  reference: string
  referenceDate: string
  validUntil: string
  deliveryDate: string
  subject: string
  body: string
  reason: string
  intro: string
  closing: string
}

export type DocDataKind = Exclude<DocKind, 'invoice'>

/**
 * Describes a document type: how it appears on the dashboard and which form fields it needs.
 * A new type = one entry here + a template (`src/template/<type>.typ`) + the type in
 * `backend/src/documents.rs`. The form (`DocumentForm`) is generated from this description.
 */
export interface DocSpec {
  kind: DocKind
  label: string
  description: string
  /** Accent color of the dashboard tile (CSS color). */
  color: string
  /** Prefix of the suggested document number. */
  numberPrefix: string
  numberLabel?: string
  dateLabel: string
  /** `priced`: quantities + prices; `quantities`: quantities only; `none`: no item list. */
  items: 'priced' | 'quantities' | 'none'
  itemsHint?: string
  reference?: { label: string; hint?: string }
  referenceDate?: string
  validUntil?: string
  deliveryDate?: string
  reason?: string
  letter?: boolean
  intro?: string
  closing?: string
}

export const DOC_SPECS: DocSpec[] = [
  {
    kind: 'invoice',
    label: 'Rechnung',
    description: 'Rechnung mit Umsatzsteuer, Zahlungsinfos, EPC-QR-Code und optional ZUGFeRD / XRechnung.',
    color: '#4a2fb0',
    numberPrefix: '',
    dateLabel: 'Rechnungsdatum',
    items: 'priced',
  },
  {
    kind: 'credit-note',
    numberLabel: 'Nummer der Stornorechnung',
    label: 'Stornorechnung',
    description: 'Storniert eine Rechnung vollständig oder teilweise – mit Bezug zur Originalrechnung.',
    color: '#d6336c',
    numberPrefix: 'ST-',
    dateLabel: 'Datum',
    items: 'priced',
    itemsHint:
      'Mengen so eingeben wie in der Originalrechnung – sie werden automatisch negativ dargestellt.',
    reference: { label: 'Stornierte Rechnung (Nr.)' },
    referenceDate: 'Datum der Originalrechnung',
    reason: 'Grund der Stornierung',
    closing: 'Der Betrag wird Ihnen erstattet bzw. mit offenen Forderungen verrechnet.',
  },
  {
    kind: 'offer',
    numberLabel: 'Angebotsnummer',
    label: 'Angebot',
    description: 'Unverbindliches oder verbindliches Angebot mit Gültigkeitsdatum und Preisübersicht.',
    color: '#f25d39',
    numberPrefix: 'AN-',
    dateLabel: 'Angebotsdatum',
    items: 'priced',
    reference: { label: 'Ihre Anfrage (optional)' },
    validUntil: 'Gültig bis',
    intro: 'vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
    closing: 'Wir freuen uns auf Ihre Rückmeldung.',
  },
  {
    kind: 'order',
    numberLabel: 'Auftragsnummer',
    label: 'Auftragsbestätigung',
    description: 'Bestätigt einen Auftrag mit Positionen, Preisen und voraussichtlichem Liefertermin.',
    color: '#0d9488',
    numberPrefix: 'AB-',
    dateLabel: 'Datum',
    items: 'priced',
    reference: { label: 'Ihre Bestellung / Angebot (optional)' },
    deliveryDate: 'Voraussichtliche Lieferung',
    intro: 'vielen Dank für Ihren Auftrag, den wir hiermit wie folgt bestätigen:',
    closing: 'Bei Rückfragen melden Sie sich gerne bei uns.',
  },
  {
    kind: 'delivery-note',
    numberLabel: 'Lieferscheinnummer',
    label: 'Lieferschein',
    description: 'Lieferschein ohne Preise mit Mengen und Unterschriftsfeld für den Empfänger.',
    color: '#2563eb',
    numberPrefix: 'LS-',
    dateLabel: 'Ausstellungsdatum',
    items: 'quantities',
    reference: { label: 'Ihre Bestellung (optional)' },
    deliveryDate: 'Lieferdatum',
    intro: 'wir liefern Ihnen folgende Positionen:',
    closing: 'Bitte prüfen Sie die Lieferung auf Vollständigkeit und Unversehrtheit.',
  },
  {
    kind: 'letter',
    label: 'Brief',
    description: 'Geschäftsbrief nach DIN 5008 mit Absenderkopf, Adressfeld, Betreff und Freitext.',
    color: '#7c3aed',
    numberPrefix: '',
    dateLabel: 'Datum',
    items: 'none',
    reference: { label: 'Ihr Zeichen (optional)' },
    letter: true,
    closing: 'Mit freundlichen Grüßen',
  },
]

export function docSpec(kind: string | undefined): DocSpec | undefined {
  return DOC_SPECS.find((spec) => spec.kind === kind)
}

export function defaultDoc(kind: DocDataKind): Doc {
  const spec = docSpec(kind)!
  const year = new Date().getFullYear()
  return {
    number: spec.numberPrefix ? `${spec.numberPrefix}${year}-001` : '',
    date: todayIso(),
    recipient: { name: 'Kunde AG', address: 'Kundenweg 5', city: '54321 Kundenstadt' },
    items:
      spec.items === 'none' ? [] : [newItem({ description: 'Beratung', quantity: 8, unit: 'h', price: 95 })],
    reference: '',
    referenceDate: '',
    validUntil: '',
    deliveryDate: '',
    subject: spec.letter ? 'Ihr Anliegen' : '',
    body: spec.letter ? 'Sehr geehrte Damen und Herren,\n\n' : '',
    reason: '',
    intro: spec.letter ? '' : (spec.intro ?? ''),
    closing: spec.closing ?? '',
  }
}

export type DocDrafts = Record<DocDataKind, Doc>

export function defaultDrafts(): DocDrafts {
  return Object.fromEntries(
    DOC_SPECS.filter((s) => s.kind !== 'invoice').map((s) => [s.kind, defaultDoc(s.kind as DocDataKind)]),
  ) as DocDrafts
}

const STORAGE_KEY = 'pdfcraft.documents'
const DRAFT_SCHEMA_VERSION = 1

function parseDoc(kind: DocDataKind, raw: unknown): Doc {
  const defaults = defaultDoc(kind)
  const doc = mergeObject({ ...defaults, items: [] } as unknown as Obj, raw) as unknown as Doc
  const rawItems = isObj(raw) && Array.isArray(raw.items) ? raw.items.slice(0, 200) : []
  doc.items = rawItems.map((item) => {
    const base = newItem()
    const { id: _id, ...rest } = mergeObject(base as unknown as Obj, item) as Obj
    void _id
    return newItem(rest as Partial<typeof base>)
  })
  return doc
}

export function loadDrafts(): DocDrafts {
  const drafts = defaultDrafts()
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (isObj(parsed) && parsed.schemaVersion === DRAFT_SCHEMA_VERSION && isObj(parsed.documents)) {
      for (const kind of Object.keys(drafts) as DocDataKind[]) {
        if (kind in parsed.documents) drafts[kind] = parseDoc(kind, parsed.documents[kind])
      }
    }
  } catch {
    // unreadable storage: start with the defaults
  }
  return drafts
}

export function saveDrafts(drafts: DocDrafts): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: DRAFT_SCHEMA_VERSION, documents: drafts }))
    return true
  } catch {
    return false
  }
}

export function clearDrafts(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
