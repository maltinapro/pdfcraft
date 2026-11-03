import { isObj } from './storage'
import { docSpec, type Doc, type DocDataKind, type DocKind } from './documents'
import { newItem, type Invoice, type InvoiceItem } from './types'

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
}

const STORAGE_KEY = 'pdfcraft.archive'
const MAX_ENTRIES = 500

export function grossTotal(items: InvoiceItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity * i.price * (1 + i.taxRate / 100), 0)
}

export function loadArchive(): ArchiveEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (Array.isArray(parsed)) {
      return parsed.filter((e): e is ArchiveEntry => isObj(e) && typeof e.id === 'string' && typeof e.kind === 'string' && !!docSpec(e.kind as string))
    }
  } catch {
    // unreadable storage
  }
  return []
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

export function makeEntry(kind: DocKind, source: Invoice | Doc): ArchiveEntry {
  const items = 'items' in source ? source.items : []
  const priced = docSpec(kind)?.items === 'priced'
  const snapshot = JSON.parse(JSON.stringify(source)) as Invoice | Doc
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    number: source.number,
    date: source.date,
    recipient: source.recipient.name,
    total: priced ? Math.round(grossTotal(items) * 100) / 100 : null,
    issuedAt: new Date().toISOString(),
    ...(kind === 'invoice' ? { invoice: snapshot as Invoice } : { doc: snapshot as Doc }),
  }
}

/** `2026-007` -> `2026-008`; numbers without trailing digits stay unchanged. */
export function incrementNumber(number: string): string {
  const m = /^(.*?)(\d+)$/.exec(number)
  return m ? m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') : number
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
