import { AppIcon } from '@maltinapro/pdfcraft-design'
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
  onSelect: (id: ZoneSpec['id']) => void
}

/** Numbered step circles with a short label, joined by lines; the full title of the active step is shown by the panel below. */
export function Stepper({ zones, active, states, onSelect }: Props) {
  return (
    <div className="stepper" role="tablist" aria-orientation="horizontal" aria-label={tr('Schritte', 'Steps')}>
      {zones.map((zone, index) => {
        const state = states[zone.id]
        const selected = zone.id === active
        const stateLabel =
          state.status === 'errors'
            ? tr(`${state.count} Fehler`, `${state.count} errors`)
            : state.status === 'warnings'
              ? tr('Hinweise', 'Notes')
              : state.status === 'complete'
                ? tr('Vollständig', 'Complete')
                : tr('Noch nicht besucht', 'Not visited')
        return (
          <div className="stepper-item" key={zone.id}>
            {index > 0 && <span className="stepper-line" aria-hidden="true" />}
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              aria-label={`${zone.number}. ${zone.label}: ${stateLabel}`}
              title={`${zone.number}. ${zone.label}`}
              className={`step zone-${zone.id} step-${state.status}${selected ? ' active' : ''}`}
              data-zone-id={zone.id}
              onClick={() => onSelect(zone.id)}
              onKeyDown={(event) => {
                const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
                if (!direction) return
                event.preventDefault()
                const next = zones[(index + direction + zones.length) % zones.length]
                onSelect(next.id)
                event.currentTarget
                  .closest('.stepper')
                  ?.querySelector<HTMLButtonElement>(`[data-zone-id="${next.id}"]`)
                  ?.focus()
              }}
            >
              <span className="step-circle" aria-hidden="true">
                {selected ? (
                  zone.number
                ) : state.status === 'errors' ? (
                  '!'
                ) : state.status === 'warnings' ? (
                  <AppIcon name="warning" size={16} />
                ) : state.status === 'complete' ? (
                  <AppIcon name="check" size={16} />
                ) : (
                  zone.number
                )}
              </span>
              <span className="step-label">{zone.id === 'sender' ? tr('Absender', 'Sender') : zone.label}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
