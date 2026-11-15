import { AppIcon } from '../icons'
import type { ZoneSpec } from '../../lib/documents'
import { tr } from '../../lib/i18n'

export type ZoneState = {
  status: 'untouched' | 'complete' | 'warnings' | 'errors'
  count?: number
}

interface Props {
  zones: readonly ZoneSpec[]
  active: ZoneSpec['id']
  states: Record<ZoneSpec['id'], ZoneState>
  compact?: boolean
  onSelect: (id: ZoneSpec['id']) => void
}

const paths: Record<ZoneSpec['id'], string> = {
  sender: 'M4 20h16M6 20V7l6-3 6 3v13M9 10h.01M15 10h.01M9 14h.01M15 14h.01M10 20v-3h4v3',
  recipient: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  details: 'M5 5h14M5 10h14M5 15h8M5 20h8',
  items: 'M4 5h16M4 10h16M4 15h16M4 20h16',
}

export function ZoneBar({ zones, active, states, compact = false, onSelect }: Props) {
  return (
    <nav
      className={`zone-bar${compact ? ' is-compact' : ''}`}
      role="tablist"
      aria-orientation="horizontal"
      aria-label={tr('Dokumentbereiche', 'Document zones')}
    >
      {zones.map((zone) => {
        const state = states[zone.id]
        const selected = zone.id === active
        const stateLabel =
          state.status === 'errors'
            ? tr(`${state.count} Fehler`, `${state.count} errors`)
            : state.status === 'warnings'
              ? tr('Hinweise', 'Warnings')
              : state.status === 'complete'
                ? tr('Vollständig', 'Complete')
                : tr('Noch nicht besucht', 'Not visited')
        return (
          <button
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            aria-label={`${zone.number}. ${zone.label}: ${stateLabel}`}
            title={`${zone.number}. ${zone.label}: ${stateLabel}`}
            className={`zone-tab zone-${zone.id} zone-state-${state.status}${selected ? ' active' : ''}`}
            key={zone.id}
            onClick={() => onSelect(zone.id)}
            onKeyDown={(event) => {
              const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
              if (!direction) return
              event.preventDefault()
              const index = zones.findIndex((item) => item.id === zone.id)
              const next = zones[(index + direction + zones.length) % zones.length]
              onSelect(next.id)
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-zone-id="${next.id}"]`)?.focus()
            }}
            data-zone-id={zone.id}
          >
            <span className="zone-tab-mark">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d={paths[zone.id]} />
              </svg>
              <span className="zone-tab-number">{zone.number}</span>
            </span>
            <span className="zone-tab-label">{zone.label}</span>
            <span className="zone-tab-state" aria-hidden="true">
              {state.status === 'errors' ? (
                state.count
              ) : state.status === 'warnings' ? (
                <AppIcon name="warning" size={16} />
              ) : state.status === 'complete' ? (
                <AppIcon name="check" size={16} />
              ) : (
                zone.number
              )}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
