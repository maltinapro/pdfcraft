import { tr } from './i18n'
import { isObj, mergeObject, type Obj } from './storage'
import { newItem, todayIso, type InvoiceItem, type Recipient } from './types'

export type DocKind = 'invoice' | 'credit-note' | 'offer' | 'order' | 'delivery-note' | 'letter'

/** Data of every document type except the invoice (see `Invoice` in `types.ts`). */
export interface Doc {
  number: string
  /** ISO date, `YYYY-MM-DD`. */
  date: string
  recipient: Recipient
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
  /** Recipient needs e-invoice data (VAT id, e-mail, buyer reference) for the ZUGFeRD / XRechnung XML. */
  einvoice?: boolean
  letter?: boolean
  intro?: string
  closing?: string
}

export const DOC_SPECS: DocSpec[] = [
  {
    kind: 'invoice',
    get label() { return tr('Rechnung', 'Invoice') },
    get description() { return tr('Rechnung mit Umsatzsteuer, Zahlungsinfos, EPC-QR-Code und optional ZUGFeRD / XRechnung.', 'Invoice with VAT, payment details, EPC QR code and optional ZUGFeRD / XRechnung.') },
    color: '#4a2fb0',
    numberPrefix: '',
    get dateLabel() { return tr('Rechnungsdatum', 'Invoice date') },
    items: 'priced',
  },
  {
    kind: 'credit-note',
    get numberLabel() { return tr('Nummer der Stornorechnung', 'Credit note number') },
    get label() { return tr('Stornorechnung', 'Credit note') },
    get description() { return tr('Storniert eine ausgestellte Rechnung mit Bezug zur Originalrechnung – auf Wunsch mit ZUGFeRD / XRechnung (Gutschrift).', 'Cancels an issued invoice with a reference to the original invoice – optionally with ZUGFeRD / XRechnung (credit note).') },
    color: '#d6336c',
    numberPrefix: 'ST-',
    get dateLabel() { return tr('Datum', 'Date') },
    items: 'priced',
    get itemsHint() {
      return tr(
        'Mengen so eingeben wie in der Originalrechnung – sie werden automatisch negativ dargestellt.',
        'Enter quantities as in the original invoice – they are shown as negative automatically.',
      )
    },
    get reference() { return { label: tr('Stornierte Rechnung (Nr.)', 'Cancelled invoice (no.)') } },
    get referenceDate() { return tr('Datum der Originalrechnung', 'Date of the original invoice') },
    get reason() { return tr('Grund der Stornierung', 'Reason for cancellation') },
    einvoice: true,
    closing: 'Der Betrag wird Ihnen erstattet bzw. mit offenen Forderungen verrechnet.',
  },
  {
    kind: 'offer',
    get numberLabel() { return tr('Angebotsnummer', 'Offer number') },
    get label() { return tr('Angebot', 'Offer') },
    get description() { return tr('Unverbindliches oder verbindliches Angebot mit Gültigkeitsdatum und Preisübersicht.', 'Non-binding or binding offer with validity date and price overview.') },
    color: '#f25d39',
    numberPrefix: 'AN-',
    get dateLabel() { return tr('Angebotsdatum', 'Offer date') },
    items: 'priced',
    get reference() { return { label: tr('Ihre Anfrage (optional)', 'Your enquiry (optional)') } },
    get validUntil() { return tr('Gültig bis', 'Valid until') },
    intro: 'vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:',
    closing: 'Wir freuen uns auf Ihre Rückmeldung.',
  },
  {
    kind: 'order',
    get numberLabel() { return tr('Auftragsnummer', 'Order number') },
    get label() { return tr('Auftragsbestätigung', 'Order confirmation') },
    get description() { return tr('Bestätigt einen Auftrag mit Positionen, Preisen und voraussichtlichem Liefertermin.', 'Confirms an order with items, prices and expected delivery date.') },
    color: '#0d9488',
    numberPrefix: 'AB-',
    get dateLabel() { return tr('Datum', 'Date') },
    items: 'priced',
    get reference() { return { label: tr('Ihre Bestellung / Angebot (optional)', 'Your order / offer (optional)') } },
    get deliveryDate() { return tr('Voraussichtliche Lieferung', 'Expected delivery') },
    intro: 'vielen Dank für Ihren Auftrag, den wir hiermit wie folgt bestätigen:',
    closing: 'Bei Rückfragen melden Sie sich gerne bei uns.',
  },
  {
    kind: 'delivery-note',
    get numberLabel() { return tr('Lieferscheinnummer', 'Delivery note number') },
    get label() { return tr('Lieferschein', 'Delivery note') },
    get description() { return tr('Lieferschein ohne Preise mit Mengen und Unterschriftsfeld für den Empfänger.', 'Delivery note without prices, with quantities and a signature field for the recipient.') },
    color: '#2563eb',
    numberPrefix: 'LS-',
    get dateLabel() { return tr('Ausstellungsdatum', 'Issue date') },
    items: 'quantities',
    get reference() { return { label: tr('Ihre Bestellung (optional)', 'Your order (optional)') } },
    get deliveryDate() { return tr('Lieferdatum', 'Delivery date') },
    intro: 'wir liefern Ihnen folgende Positionen:',
    closing: 'Bitte prüfen Sie die Lieferung auf Vollständigkeit und Unversehrtheit.',
  },
  {
    kind: 'letter',
    get label() { return tr('Brief', 'Letter') },
    get description() { return tr('Geschäftsbrief nach DIN 5008 mit Absenderkopf, Adressfeld, Betreff und Freitext.', 'Business letter following DIN 5008 with sender header, address field, subject and free text.') },
    color: '#7c3aed',
    numberPrefix: '',
    get dateLabel() { return tr('Datum', 'Date') },
    items: 'none',
    get reference() { return { label: tr('Ihr Zeichen (optional)', 'Your reference (optional)') } },
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
    recipient: {
      name: 'Kunde AG',
      address: 'Kundenweg 5',
      city: '54321 Kundenstadt',
      vatId: '',
      email: '',
      buyerReference: '',
    },
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

/** Validates stored or imported drafts and fills missing document types with defaults. */
export function parseDrafts(parsed: unknown): DocDrafts {
  const drafts = defaultDrafts()
  if (isObj(parsed) && parsed.schemaVersion === DRAFT_SCHEMA_VERSION && isObj(parsed.documents)) {
    for (const kind of Object.keys(drafts) as DocDataKind[]) {
      if (kind in parsed.documents) drafts[kind] = parseDoc(kind, parsed.documents[kind])
    }
  }
  return drafts
}

export const serializeDrafts = (drafts: DocDrafts) => ({ schemaVersion: DRAFT_SCHEMA_VERSION, documents: drafts })

export function loadDrafts(): DocDrafts {
  try {
    return parseDrafts(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return defaultDrafts()
  }
}

export function saveDrafts(drafts: DocDrafts): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeDrafts(drafts)))
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

/** Documents that can be created from an issued document (the document chain). */
const followUps = (): Record<DocKind, { to: DocKind; label: string }[]> => ({
  offer: [
    { to: 'order', label: tr('Auftragsbestätigung', 'Order confirmation') },
    { to: 'invoice', label: tr('Rechnung', 'Invoice') },
  ],
  order: [
    { to: 'delivery-note', label: tr('Lieferschein', 'Delivery note') },
    { to: 'invoice', label: tr('Rechnung', 'Invoice') },
  ],
  'delivery-note': [{ to: 'invoice', label: tr('Rechnung', 'Invoice') }],
  invoice: [{ to: 'credit-note', label: tr('Stornieren', 'Issue credit note') }],
  'credit-note': [],
  letter: [],
})

/** Evaluated at render time so labels follow the UI language. */
export const FOLLOW_UPS: Record<DocKind, { to: DocKind; label: string }[]> = new Proxy({} as Record<DocKind, { to: DocKind; label: string }[]>, {
  get: (_t, kind: string) => followUps()[kind as DocKind],
})
