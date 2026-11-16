import type { ArchiveEntry } from './archive'
import { docSpec, type DocKind } from './documents'

/** `cancelled`: credit notes cover the invoice; `credited`: a credit note exists, but not for the whole amount (or the amounts are unknown). */
export type EntryStatus = 'cancelled' | 'credited' | null

export type Period = 'month' | 'year'

export interface ArchiveFilter {
  query: string
  kind: DocKind | null
  period: Period | null
  /** Only invoices that have a credit note. */
  cancelled: boolean
}

export const NO_FILTER: ArchiveFilter = { query: '', kind: null, period: null, cancelled: false }

export const isFiltered = (filter: ArchiveFilter): boolean =>
  filter.query.trim() !== '' || filter.kind !== null || filter.period !== null || filter.cancelled

const cents = (value: number) => Math.round(Math.abs(value) * 100)

/** Status of every invoice that has at least one credit note (by invoice number). */
export function entryStatuses(entries: ArchiveEntry[]): Map<string, EntryStatus> {
  const credited = new Map<string, number | null>()
  for (const entry of entries) {
    const reference = entry.kind === 'credit-note' ? entry.doc?.reference?.trim() : ''
    if (!reference) continue
    const sum = credited.get(reference)
    credited.set(reference, sum === null || entry.total === null ? null : (sum ?? 0) + cents(entry.total))
  }
  const statuses = new Map<string, EntryStatus>()
  for (const entry of entries) {
    if (entry.kind !== 'invoice' || !credited.has(entry.number.trim())) continue
    const sum = credited.get(entry.number.trim())
    statuses.set(entry.id, sum != null && entry.total !== null && sum >= cents(entry.total) ? 'cancelled' : 'credited')
  }
  return statuses
}

const inPeriod = (date: string, period: Period, now: Date): boolean => {
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return period === 'year' ? date.startsWith(`${year}-`) : date.startsWith(`${year}-${month}`)
}

/** Search (number, recipient, type) plus type, period and credit-note filters; the order of `entries` is kept. */
export function filterEntries(entries: ArchiveEntry[], filter: ArchiveFilter, now: Date = new Date()): ArchiveEntry[] {
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean)
  const statuses = filter.cancelled ? entryStatuses(entries) : null
  return entries.filter((entry) => {
    if (filter.kind && entry.kind !== filter.kind) return false
    if (filter.period && !inPeriod(entry.date, filter.period, now)) return false
    if (statuses && !statuses.get(entry.id)) return false
    if (terms.length === 0) return true
    const haystack = `${entry.number} ${entry.recipient} ${docSpec(entry.kind)?.label ?? ''}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
