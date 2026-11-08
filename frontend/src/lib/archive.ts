import { isObj } from './storage'
import { tr } from './i18n'
import type { Issue } from './validate'
import { docSpec, type Doc, type DocDataKind, type DocKind } from './documents'
import { newItem, type Invoice, type InvoiceItem, type Settings, type StampInfo } from './types'

/** A document that was downloaded. Issued documents are final: they are never edited, only cancelled or copied. */
export interface ArchiveEntry {
  id: string
  kind: DocKind
  number: string
  /** ISO date of the document. */
  date: string
  recipient: string
  /** Gross total (display only; the backend computes the real amounts). */
  total: number | null
  issuedAt: string
  /** Invoice data when `kind` is `invoice`, otherwise `doc`. */
  invoice?: Invoice
  doc?: Doc
  /** Sender and design at issue time, without logo and signature (entries from older versions have none). */
  settings?: Omit<Settings, 'logo' | 'signature'>
  /** Internetmarke that was printed on this document (used up; the image is not kept). */
  stamp?: StampInfo
}

const STORAGE_KEY = 'pdfcraft.archive'
const MAX_ENTRIES = 500

export function grossTotal(items: InvoiceItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity * i.price * (1 + i.taxRate / 100), 0)
}

export function validEntries(parsed: unknown): ArchiveEntry[] {
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (e): e is ArchiveEntry =>
      isObj(e) &&
      typeof e.id === 'string' &&
      typeof e.kind === 'string' &&
      !!docSpec(e.kind) &&
      isObj(e.kind === 'invoice' ? e.invoice : e.doc) &&
      isObj((isObj(e.invoice) ? e.invoice : (e.doc as Record<string, unknown>)).recipient),
  )
}

export function loadArchive(): ArchiveEntry[] {
  try {
    return validEntries(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return []
  }
}

export function saveArchive(entries: ArchiveEntry[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
    return true
  } catch {
    return false
  }
}

export function clearArchive(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function makeEntry(kind: DocKind, source: Invoice | Doc, settings: Settings): ArchiveEntry {
  const { logo: _logo, signature: _signature, ...snapshotSettings } = settings
  void _logo
  void _signature
  const items = 'items' in source ? source.items : []
  const priced = docSpec(kind)?.items === 'priced'
  const { postage, ...rest } = JSON.parse(JSON.stringify(source)) as Invoice | Doc
  const snapshot = rest as Invoice | Doc
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    number: source.number,
    date: source.date,
    recipient: source.recipient.name,
    total: priced ? Math.round(grossTotal(items) * 100) / 100 : null,
    issuedAt: new Date().toISOString(),
    settings: JSON.parse(JSON.stringify(snapshotSettings)) as Omit<Settings, 'logo' | 'signature'>,
    ...(postage ? { stamp: { voucherId: postage.voucherId, productName: postage.productName, priceCents: postage.priceCents } } : {}),
    ...(kind === 'invoice' ? { invoice: snapshot as Invoice } : { doc: snapshot as Doc }),
  }
}

/** `2026-007` -> `2026-008`; numbers without trailing digits stay unchanged. */
export function incrementNumber(number: string): string {
  const m = /^(.*?)(\d+)$/.exec(number)
  return m ? m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') : number
}

/** Warning when `number` was already issued for this document type (numbers must be unique). */
export function duplicateNumberIssue(entries: ArchiveEntry[], kind: DocKind, number: string): Issue | null {
  const n = number.trim()
  if (!n || !entries.some((e) => e.kind === kind && e.number.trim() === n)) return null
  return {
    level: 'warning',
    field: 'number',
    message: tr(
      `Nummer ${n} wurde schon ausgestellt – Belegnummern müssen eindeutig sein`,
      `Number ${n} was already issued – document numbers must be unique`,
    ),
  }
}

/** Numbers of cancelled invoices: every issued credit note references one. */
export function cancelledNumbers(entries: ArchiveEntry[]): Set<string> {
  return new Set(entries.filter((e) => e.kind === 'credit-note' && e.doc?.reference).map((e) => e.doc!.reference.trim()))
}

const freshItems = (items: InvoiceItem[]) =>
  items.map((item) => {
    const { id: _id, ...rest } = item
    void _id
    return newItem(rest)
  })

/** Draft of `target`, prefilled from an issued document (recipient, items and the reference to it). */
export function followUpDraft(
  entry: ArchiveEntry,
  target: DocKind,
  base: Invoice | Doc,
): Invoice | Doc {
  const source = entry.invoice ?? entry.doc!
  const items = freshItems('items' in source ? source.items : [])
  const common = { recipient: { ...source.recipient }, items }
  if (target === 'invoice') {
    return { ...(base as Invoice), ...common }
  }
  const doc = base as Doc
  const next: Doc = { ...doc, ...common, reference: entry.number }
  if (target === 'credit-note') next.referenceDate = entry.date
  if (target === 'order' && entry.kind === 'offer') next.reference = entry.number
  return next
}

export type { DocDataKind }

/** Entries grouped by their issue-time settings (one bulk request per group); logo and signature are always the current ones. */
export function groupBySettings(entries: ArchiveEntry[], current: Settings): { settings: Settings; entries: ArchiveEntry[] }[] {
  const groups = new Map<string, { settings: Settings; entries: ArchiveEntry[] }>()
  for (const entry of entries) {
    const settings: Settings = entry.settings ? { ...current, ...entry.settings, logo: current.logo, signature: current.signature } : current
    const key = JSON.stringify(entry.settings ?? null)
    const group = groups.get(key) ?? { settings, entries: [] }
    group.entries.push(entry)
    groups.set(key, group)
  }
  return [...groups.values()]
}
