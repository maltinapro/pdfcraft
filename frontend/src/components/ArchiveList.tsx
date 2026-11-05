import { FOLLOW_UPS, docSpec, type DocKind } from '../lib/documents'
import type { ArchiveEntry } from '../lib/archive'
import { tr, uiLocale, useLang } from '../lib/i18n'

interface Props {
  entries: ArchiveEntry[]
  /** Numbers of invoices that already have a credit note. */
  cancelled: Set<string>
  onFollowUp: (entry: ArchiveEntry, target: DocKind) => void
  /** Checkbox selection (only on the full list). */
  selected?: string[]
  onToggle?: (id: string) => void
}

/** Issued documents with their follow-up actions (cancel, next document in the chain). */
export function ArchiveList({ entries, cancelled, onFollowUp, selected, onToggle }: Props) {
  useLang()
  const money = (n: number) => n.toLocaleString(uiLocale(), { style: 'currency', currency: 'EUR' })
  return (
    <ul className="archive-list">
      {entries.map((e) => {
        const done = e.kind === 'invoice' && cancelled.has(e.number.trim())
        return (
          <li key={e.id} className="archive-item">
            {selected && onToggle && (
              <input type="checkbox" checked={selected.includes(e.id)} onChange={() => onToggle(e.id)} aria-label={tr(`${e.number} wählen`, `Select ${e.number}`)} />
            )}
            <div className="archive-main">
              <strong>{docSpec(e.kind)?.label} {e.number}</strong>
              {done && <span className="badge">{tr('Gutschrift erstellt', 'credit note issued')}</span>}
              <span className="archive-sub">{e.recipient} · {new Date(e.date).toLocaleDateString(uiLocale())}{e.total !== null ? ` · ${money(e.total)}` : ''}</span>
            </div>
            <div className="archive-actions">
              {FOLLOW_UPS[e.kind].map((f) => (
                <button key={f.to} className="btn" onClick={() => onFollowUp(e, f.to)}>{f.label}</button>
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
