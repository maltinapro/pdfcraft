import { useEffect, useRef } from 'react'
import { DocIcon } from './icons'
import { Chip, Menu, MenuItem } from './ui'
import { FOLLOW_UPS, docSpec, type DocKind } from '../lib/documents'
import type { ArchiveEntry } from '../lib/archive'
import type { EntryStatus } from '../lib/archiveFilter'
import { tr, uiLocale, useLang } from '../lib/i18n'

const LONG_PRESS_MS = 500

interface Props {
  entries: ArchiveEntry[]
  /** Credit-note status per invoice id (see `entryStatuses`). */
  statuses: Map<string, EntryStatus>
  onFollowUp: (entry: ArchiveEntry, target: DocKind) => void
  /** Renders the PDF again from the stored snapshot. */
  onRerender?: (entry: ArchiveEntry) => void
  onDelete?: (entry: ArchiveEntry) => void
  /** Selection mode (full list only): rows show a checkbox, a tap toggles. */
  selecting?: boolean
  selected?: string[]
  onToggle?: (id: string) => void
  /** Long press on a row starts the selection mode with that row. */
  onLongPress?: (id: string) => void
}

/** Issued documents as an M3 list: type icon, number, recipient · date, amount, status and an overflow menu. */
export function ArchiveList({ entries, statuses, onFollowUp, onRerender, onDelete, selecting = false, selected = [], onToggle, onLongPress }: Props) {
  useLang()
  const timer = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const money = (n: number) => n.toLocaleString(uiLocale(), { style: 'currency', currency: 'EUR' })

  const cancelPress = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  // A pending long press must not fire after the list is gone
  useEffect(() => () => cancelPress(), [])
  const startPress = (id: string) => {
    if (!onLongPress) return
    cancelPress()
    timer.current = window.setTimeout(() => {
      timer.current = null
      suppressClick.current = true
      onLongPress(id)
    }, LONG_PRESS_MS)
  }

  return (
    <ul className="doc-list">
      {entries.map((e) => {
        const label = docSpec(e.kind)?.label ?? e.kind
        const status = statuses.get(e.id) ?? null
        const isSelected = selected.includes(e.id)
        const body = (
          <>
            <span className="doc-row-title">{label} {e.number}</span>
            <span className="doc-row-sub">{e.recipient} · {new Date(e.date).toLocaleDateString(uiLocale())}</span>
          </>
        )
        const followUps = FOLLOW_UPS[e.kind]
        return (
          <li key={e.id} className={`doc-row${isSelected ? ' doc-row-selected' : ''}`}>
            {selecting ? (
              <label className="doc-row-check">
                <input type="checkbox" checked={isSelected} onChange={() => onToggle?.(e.id)} aria-label={tr(`${label} ${e.number} wählen`, `Select ${label} ${e.number}`)} />
              </label>
            ) : (
              <span className="doc-row-lead" aria-hidden="true"><DocIcon kind={e.kind} size={22} /></span>
            )}
            <div
              className="doc-row-main"
              role="presentation"
              onPointerDown={() => startPress(e.id)}
              onPointerUp={cancelPress}
              onPointerLeave={cancelPress}
              onPointerCancel={cancelPress}
              onContextMenu={(ev) => { if (onLongPress) ev.preventDefault() }}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false
                  return
                }
                if (selecting) onToggle?.(e.id)
              }}
            >
              {body}
            </div>
            <div className="doc-row-end">
              {e.total !== null && <span className="doc-row-amount">{money(e.total)}</span>}
              {(status || e.stamp) && (
                <span className="doc-row-chips">
                  {status && (
                    <Chip kind="status" className="ui-chip-small">
                      {status === 'cancelled' ? tr('Storniert', 'Cancelled') : tr('Gutschrift erstellt', 'Credit note issued')}
                    </Chip>
                  )}
                  {e.stamp && <Chip className="ui-chip-small" title={e.stamp.voucherId}>{tr('mit Briefmarke', 'with postage stamp')}</Chip>}
                </span>
              )}
            </div>
            {!selecting && (
              <Menu label={tr(`Aktionen für ${label} ${e.number}`, `Actions for ${label} ${e.number}`)}>
                {onRerender && <MenuItem onClick={() => onRerender(e)}>{tr('PDF erneut erstellen', 'Create PDF again')}</MenuItem>}
                {followUps.map((f) => (
                  <MenuItem key={f.to} onClick={() => onFollowUp(e, f.to)}>{f.label}</MenuItem>
                ))}
                {onDelete && <MenuItem danger onClick={() => onDelete(e)}>{tr('Aus Liste entfernen', 'Remove from list')}</MenuItem>}
              </Menu>
            )}
          </li>
        )
      })}
    </ul>
  )
}
