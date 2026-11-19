import { tr } from './i18n'
import { isObj, mergeObject, parsePostage, type Obj } from './storage'
import { newItem, todayIso, type InvoiceItem, type PostageStamp, type Recipient } from './types'

export type DocKind = 'invoice' | 'credit-note' | 'offer' | 'order' | 'delivery-note' | 'letter' | 'dunning'
export type ZoneId = 'sender' | 'recipient' | 'details' | 'items'

export interface ZoneRect {
  zone: number
  page: number
  x: number
  y: number
  w: number
  h: number
}

export interface ZoneSpec {
  id: ZoneId
  number: number
  readonly label: string
  fields: readonly string[]
}

const senderFields = [
  'settings.logo',
  'settings.signature',
  'settings.sender.name',
  'settings.sender.address',
  'settings.sender.city',
  'settings.sender.taxNr',
  'settings.sender.vatId',
  'settings.sender.email',
  'settings.sender.phone',
  'settings.sender.contactName',
  'settings.design',
  'settings.accentColor',
  'settings.font',
  'settings.locale',
  'settings.footer',
] as const
const invoiceSettingsFields = [
  'settings.bank.name',
  'settings.bank.iban',
  'settings.bank.bic',
  'settings.intro',
  'settings.closing',
  'settings.zugferd',
  'settings.einvoiceProfile',
] as const
const recipientFields = ['recipient.name', 'recipient.address', 'recipient.city', 'postage'] as const
const invoiceRecipientFields = [
  'recipient.name',
  'recipient.address',
  'recipient.city',
  'recipient.email',
  'recipient.vatId',
  'recipient.buyerReference',
  'postage',
] as const
const itemFields = ['items', 'items[*].description', 'items[*].quantity', 'items[*].unit', 'items[*].price', 'items[*].taxRate'] as const

const zone = (id: ZoneId, number: number, label: () => string, fields: readonly string[]): ZoneSpec => ({
  id,
  number,
  get label() {
    return label()
  },
  fields,
})

/** Field ownership for the paper-first editor. Keep these keys aligned with the form controls. */
export const ZONES: Record<DocKind, readonly ZoneSpec[]> = {
  invoice: [
    zone('sender', 1, () => tr('Absender & Aussehen', 'Sender & look'), [...senderFields, ...invoiceSettingsFields]),
    zone('recipient', 2, () => tr('Empfänger', 'Recipient'), invoiceRecipientFields),
    zone('details', 3, () => tr('Details', 'Details'), ['number', 'date', 'serviceDate', 'serviceDateFrom', 'serviceDateTo', 'dueDate', 'settings.paymentDays']),
    zone('items', 4, () => tr('Positionen', 'Items'), [...itemFields, 'settings.exemptionReason']),
  ],
  'credit-note': [
    zone('sender', 1, () => tr('Absender & Aussehen', 'Sender & look'), senderFields),
    zone('recipient', 2, () => tr('Empfänger', 'Recipient'), [...recipientFields, 'recipient.email', 'recipient.vatId', 'recipient.buyerReference']),
    zone('details', 3, () => tr('Details', 'Details'), ['number', 'date', 'reference', 'referenceDate', 'reason']),
    zone('items', 4, () => tr('Positionen', 'Items'), [...itemFields, 'intro', 'closing']),
  ],
  offer: [
    zone('sender', 1, () => tr('Absender & Aussehen', 'Sender & look'), senderFields),
    zone('recipient', 2, () => tr('Empfänger', 'Recipient'), recipientFields),
    zone('details', 3, () => tr('Details', 'Details'), ['number', 'date', 'reference', 'validUntil', 'intro']),
    zone('items', 4, () => tr('Positionen', 'Items'), [...itemFields, 'closing']),
  ],
  order: [
    zone('sender', 1, () => tr('Absender & Aussehen', 'Sender & look'), senderFields),
    zone('recipient', 2, () => tr('Empfänger', 'Recipient'), recipientFields),
    zone('details', 3, () => tr('Details', 'Details'), ['number', 'date', 'reference', 'deliveryDate', 'intro']),
    zone('items', 4, () => tr('Positionen', 'Items'), [...itemFields, 'closing']),
  ],
  'delivery-note': [
    zone('sender', 1, () => tr('Absender & Aussehen', 'Sender & look'), senderFields),
    zone('recipient', 2, () => tr('Empfänger', 'Recipient'), recipientFields),
    zone('details', 3, () => tr('Details', 'Details'), ['number', 'date', 'reference', 'deliveryDate', 'intro']),
    zone('items', 4, () => tr('Positionen', 'Items'), [...itemFields.filter((field) => !field.endsWith('.price') && !field.endsWith('.taxRate')), 'closing']),
  ],
  dunning: [
    zone('sender', 1, () => tr('Absender & Aussehen', 'Sender & look'), [...senderFields, 'settings.bank.name', 'settings.bank.iban', 'settings.bank.bic']),
    zone('recipient', 2, () => tr('Empfänger', 'Recipient'), recipientFields),
    zone('details', 3, () => tr('Details', 'Details'), ['number', 'date', 'dunningLevel', 'paymentDeadline', 'intro']),
    zone('items', 4, () => tr('Offene Posten', 'Open items'), [
      'invoices',
      'invoices[*].number',
      'invoices[*].date',
      'invoices[*].dueDate',
      'invoices[*].openAmount',
      'fees',
      'fees[*].description',
      'fees[*].amount',
      'interest.debtor',
      'interest.rate',
      'interest.from',
      'interest.to',
      'interest.amount',
      'interest.baseRate',
      'closing',
    ]),
  ],
  letter: [
    zone('sender', 1, () => tr('Absender & Aussehen', 'Sender & look'), senderFields),
    zone('recipient', 2, () => tr('Empfänger', 'Recipient'), recipientFields),
    zone('details', 3, () => tr('Details', 'Details'), ['date', 'reference']),
    zone('items', 4, () => tr('Text', 'Text'), ['subject', 'body', 'closing']),
  ],
}

export function zoneForField(kind: DocKind, field: string): ZoneId | undefined {
  return ZONES[kind].find(({ fields }) =>
    fields.some((key) => {
      if (!key.includes('[*]')) return key === field
      const [prefix, suffix] = key.split('[*]')
      const index = field.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[(\\d+)\\]`))
      return !!index && field.slice(index[0].length) === suffix
    }),
  )?.id
}

export type InterestMode = 'none' | 'consumer' | 'business' | 'manual'

export interface DunningInvoice {
  id: string
  number: string
  /** ISO dates, `YYYY-MM-DD`. */
  date: string
  dueDate: string
  /** Still open gross amount in euro. */
  openAmount: number
}

export interface DunningFee {
  id: string
  description: string
  amount: number
}

/** Dunning letter data. `consumer`/`business`: PDFCraft calculates the default interest from the base rate. */
export interface DunningData {
  level: 1 | 2 | 3
  paymentDeadline: string
  invoices: DunningInvoice[]
  fees: DunningFee[]
  interest: {
    mode: InterestMode
    /** Calculation: optional start (default: the day after each due date) and end (default: the document date). */
    from: string
    to: string
    /** `manual` only: annual rate in percent and the interest amount in euro. */
    rate: number
    amount: number
    /** Calculation: base rate in percent instead of the built-in table (empty = table). */
    baseRate: string
  }
}

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
  postage?: PostageStamp | null
  /** Only for the dunning letter. */
  dunning?: DunningData
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
  dunning?: boolean
  intro?: string
  closing?: string
}

export const DOC_SPECS: DocSpec[] = [
  {
    kind: 'invoice',
    get label() { return tr('Rechnung', 'Invoice') },
    get description() { return tr('Rechnung mit Umsatzsteuer, Zahlungsinfos, EPC-QR-Code und optional ZUGFeRD / XRechnung.', 'Invoice with VAT, payment details, EPC QR code and optional ZUGFeRD / XRechnung.') },
    numberPrefix: '',
    get dateLabel() { return tr('Rechnungsdatum', 'Invoice date') },
    items: 'priced',
  },
  {
    kind: 'credit-note',
    get numberLabel() { return tr('Nummer der Stornorechnung', 'Credit note number') },
    get label() { return tr('Stornorechnung', 'Credit note') },
    get description() { return tr('Storniert eine ausgestellte Rechnung mit Bezug zur Originalrechnung – auf Wunsch mit ZUGFeRD / XRechnung (Gutschrift).', 'Cancels an issued invoice with a reference to the original invoice – optionally with ZUGFeRD / XRechnung (credit note).') },
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
    numberPrefix: 'LS-',
    get dateLabel() { return tr('Ausstellungsdatum', 'Issue date') },
    items: 'quantities',
    get reference() { return { label: tr('Ihre Bestellung (optional)', 'Your order (optional)') } },
    get deliveryDate() { return tr('Lieferdatum', 'Delivery date') },
    intro: 'wir liefern Ihnen folgende Positionen:',
    closing: 'Bitte prüfen Sie die Lieferung auf Vollständigkeit und Unversehrtheit.',
  },
  {
    kind: 'dunning',
    get numberLabel() { return tr('Mahnungsnummer', 'Dunning number') },
    get label() { return tr('Mahnung', 'Dunning letter') },
    get description() { return tr('Zahlungserinnerung oder Mahnung mit offenen Rechnungen, Mahngebühren, Verzugszinsen aus dem Basiszinssatz und neuer Zahlungsfrist.', 'Payment reminder or dunning letter with open invoices, fees, default interest from the base rate and a new payment deadline.') },
    numberPrefix: 'M-',
    get dateLabel() { return tr('Datum', 'Date') },
    items: 'none',
    dunning: true,
    intro: '',
    closing: '',
  },
  {
    kind: 'letter',
    get label() { return tr('Brief', 'Letter') },
    get description() { return tr('Geschäftsbrief nach DIN 5008 mit Absenderkopf, Adressfeld, Betreff und Freitext.', 'Business letter following DIN 5008 with sender header, address field, subject and free text.') },
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

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const newDunningInvoice = (partial: Partial<DunningInvoice> = {}): DunningInvoice => ({
  id: newItem().id,
  number: '',
  date: '',
  dueDate: '',
  openAmount: 0,
  ...partial,
})

export const newDunningFee = (partial: Partial<DunningFee> = {}): DunningFee => ({
  id: newItem().id,
  description: '',
  amount: 0,
  ...partial,
})

export function defaultDunning(): DunningData {
  const today = todayIso()
  return {
    level: 1,
    paymentDeadline: addDays(today, 14),
    invoices: [newDunningInvoice({ number: `${new Date().getFullYear()}-001`, date: addDays(today, -45), dueDate: addDays(today, -31), openAmount: 1190 })],
    fees: [],
    interest: { mode: 'none', from: '', to: '', rate: 0, amount: 0, baseRate: '' },
  }
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
    ...(spec.dunning ? { dunning: defaultDunning() } : {}),
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
  doc.postage = parsePostage(isObj(raw) ? raw.postage : null)
  if (docSpec(kind)?.dunning) doc.dunning = parseDunning(isObj(raw) ? raw.dunning : null)
  return doc
}

/** A stored dunning section; anything invalid falls back to the defaults. */
export function parseDunning(raw: unknown): DunningData {
  const base = defaultDunning()
  if (!isObj(raw)) return base
  const level = raw.level === 2 || raw.level === 3 ? raw.level : 1
  const list = (value: unknown, max: number) => (Array.isArray(value) ? value.slice(0, max).filter(isObj) : [])
  const interest = mergeObject(base.interest as unknown as Obj, raw.interest) as unknown as DunningData['interest']
  if (!['none', 'consumer', 'business', 'manual'].includes(interest.mode)) interest.mode = 'none'
  return {
    level,
    paymentDeadline: typeof raw.paymentDeadline === 'string' ? raw.paymentDeadline : base.paymentDeadline,
    invoices: list(raw.invoices, 100).map((row) => {
      const { id: _id, ...rest } = mergeObject(newDunningInvoice() as unknown as Obj, row) as Obj
      void _id
      return newDunningInvoice(rest as Partial<DunningInvoice>)
    }),
    fees: list(raw.fees, 20).map((row) => {
      const { id: _id, ...rest } = mergeObject(newDunningFee() as unknown as Obj, row) as Obj
      void _id
      return newDunningFee(rest as Partial<DunningFee>)
    }),
    interest,
  }
}

/** The dunning fields of the `POST /v1/documents` body (the UI shape is flattened and the ids are dropped). */
export function dunningPayload(data: DunningData | undefined): Record<string, unknown> {
  const d = data ?? defaultDunning()
  const { mode, from, to, rate, amount, baseRate } = d.interest
  const interest =
    mode === 'none'
      ? undefined
      : mode === 'manual'
        ? { rate, from, to, amount }
        : {
            debtor: mode,
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            ...(baseRate.trim() !== '' && Number.isFinite(Number(baseRate)) ? { baseRate: Number(baseRate) } : {}),
          }
  return {
    dunningLevel: d.level,
    paymentDeadline: d.paymentDeadline,
    invoices: d.invoices.map(({ number, date, dueDate, openAmount }) => ({ number, date, dueDate, openAmount })),
    fees: d.fees.map(({ description, amount }) => ({ description, amount })),
    ...(interest ? { interest } : {}),
  }
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
    { to: 'order', label: tr('Auftragsbestätigung aus diesem Angebot', 'Order confirmation from this offer') },
    { to: 'invoice', label: tr('Rechnung aus diesem Angebot', 'Invoice from this offer') },
  ],
  order: [
    { to: 'delivery-note', label: tr('Lieferschein aus dieser Auftragsbestätigung', 'Delivery note from this order confirmation') },
    { to: 'invoice', label: tr('Rechnung aus dieser Auftragsbestätigung', 'Invoice from this order confirmation') },
  ],
  'delivery-note': [{ to: 'invoice', label: tr('Rechnung aus diesem Lieferschein', 'Invoice from this delivery note') }],
  invoice: [
    { to: 'credit-note', label: tr('Stornieren', 'Issue credit note') },
    { to: 'dunning', label: tr('Mahnung zu dieser Rechnung', 'Dunning letter for this invoice') },
  ],
  dunning: [],
  'credit-note': [],
  letter: [],
})

/** Evaluated at render time so labels follow the UI language. */
export const FOLLOW_UPS: Record<DocKind, { to: DocKind; label: string }[]> = new Proxy({} as Record<DocKind, { to: DocKind; label: string }[]>, {
  get: (_t, kind: string) => followUps()[kind as DocKind],
})
